/**
 * Validación de cada modelo físico contra pvlib-python (valores en fixtures/, generados
 * con scripts/pvlib-fixtures/generar.py). Las tolerancias están indicadas en cada caso.
 */
import { describe, expect, it } from 'vitest';
import { posicionSolar } from '../solar/spa';
import { irradianciaExtraterrestre, masaDeAireRelativa } from '../irradiancia/basicos';
import { perez } from '../irradiancia/perez';
import { iamAshrae, iamFresnel, integrarIAM } from '../irradiancia/iam';
import { erbs } from '../irradiancia/erbs';
import { temperaturaCelda } from '../termico/faiman';
import { calcParamsCEC, corrienteAVoltaje, resolverUnDiodo, bandaProhibida } from '../modulo/unDiodo';
import { inversorSandia } from '../inversor/sandia';
import modulos from '../../catalogo/semilla/modulosCEC.json';
import inversores from '../../catalogo/semilla/inversoresCEC.json';
import spaFx from './fixtures/spa.json';
import basFx from './fixtures/basicos.json';
import perezFx from './fixtures/perez.json';
import iamFx from './fixtures/iam.json';
import erbsFx from './fixtures/erbs.json';
import termFx from './fixtures/termico.json';
import diodoFx from './fixtures/unDiodo.json';
import sandiaFx from './fixtures/sandia.json';

const difAngulo = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe('SPA — posición solar (vs pvlib.solarposition.spa_python)', () => {
  for (const caso of spaFx) {
    it(`lat ${caso.sitio.lat}, lon ${caso.sitio.lon}: |Δ| < 1e-6°`, () => {
      let maxZ = 0;
      let maxA = 0;
      caso.unix.forEach((u: number, i: number) => {
        const p = posicionSolar(u, {
          latitud: caso.sitio.lat, longitud: caso.sitio.lon, altitud: caso.sitio.alt,
          presion: caso.presion_hPa, temperatura: 12, deltaT: 69,
        });
        maxZ = Math.max(maxZ, Math.abs(p.cenit - caso.cenit[i]));
        maxA = Math.max(maxA, difAngulo(p.azimutPVsyst, caso.azimutPVsyst[i]));
        expect(p.ecuacionDelTiempo).toBeCloseTo(caso.eot[i], 6);
      });
      expect(maxZ).toBeLessThan(1e-6);
      expect(maxA).toBeLessThan(1e-6);
    });
  }
});

describe('Irradiancia básica', () => {
  it('extraterrestre (Spencer) coincide con pvlib', () => {
    basFx.doy.forEach((d: number, i: number) => expect(irradianciaExtraterrestre(d)).toBeCloseTo(basFx.extra[i], 8));
  });
  it('masa de aire Kasten-Young coincide con pvlib', () => {
    basFx.cenit.forEach((z: number, i: number) => expect(masaDeAireRelativa(z)).toBeCloseTo(basFx.am[i], 9));
  });
});

describe('Perez 1990 (vs pvlib.irradiance.perez)', () => {
  it('300 casos aleatorios, |Δ| < 1e-6 W/m² por componente', () => {
    const f = perezFx;
    for (let i = 0; i < f.dhi.length; i++) {
      const r = perez(f.inclinacion[i], f.azimutPlano[i], f.dhi[i], f.dni[i], f.extra[i], f.cenit[i], f.azimutSol[i], f.am[i]);
      expect(Math.abs(r.total - f.total[i])).toBeLessThan(1e-6);
      if (r.total > 0) {
        expect(Math.abs(r.isotropica - f.isotropica[i])).toBeLessThan(1e-6);
        expect(Math.abs(r.circunsolar - f.circunsolar[i])).toBeLessThan(1e-6);
        expect(Math.abs(r.horizonte - f.horizonte[i])).toBeLessThan(1e-6);
      }
    }
  });
});

describe('IAM', () => {
  it('ASHRAE b0 = 0.05 y 0.04', () => {
    iamFx.aoi.forEach((a: number, i: number) => {
      expect(iamAshrae(a, 0.05)).toBeCloseTo(iamFx.ashrae005[i], 10);
      expect(iamAshrae(a, 0.04)).toBeCloseTo(iamFx.ashrae004[i], 10);
    });
  });
  it('Fresnel físico (n = 1.526, K = 4, L = 2 mm)', () => {
    iamFx.aoi.forEach((a: number, i: number) => expect(iamFresnel(a)).toBeCloseTo(iamFx.fresnel[i], 9));
  });
  it('IAM difuso integrado (Marion 2017) coincide con pvlib.iam.marion_diffuse', () => {
    iamFx.tilts.forEach((t: number, i: number) => {
      expect(integrarIAM((a) => iamAshrae(a, 0.05), t, 'cielo')).toBeCloseTo(iamFx.marionCieloAshrae[i], 6);
      expect(integrarIAM((a) => iamAshrae(a, 0.05), t, 'suelo')).toBeCloseTo(iamFx.marionSueloAshrae[i], 6);
      expect(integrarIAM((a) => iamFresnel(a), t, 'cielo')).toBeCloseTo(iamFx.marionCieloFresnel[i], 6);
    });
  });
});

describe('Erbs', () => {
  it('descomposición GHI → DNI/DHI', () => {
    erbsFx.ghi.forEach((g: number, i: number) => {
      const r = erbs(g, erbsFx.cenit[i], erbsFx.extra[i]);
      expect(r.dhi).toBeCloseTo(erbsFx.dhi[i], 7);
      expect(r.dni).toBeCloseTo(erbsFx.dni[i], 6);
    });
  });
});

describe('Temperatura de celda Faiman/PVsyst (vs pvlib.temperature.pvsyst_cell)', () => {
  it('Uc = 29, Uv = 0, η = 0.21', () => {
    termFx.poa.forEach((g: number, i: number) => {
      const tc = temperaturaCelda(g, termFx.ta[i], termFx.ws[i], { Uc: 29, Uv: 0, absortancia: 0.9 }, 0.21);
      expect(tc).toBeCloseTo(termFx.tc_29_0[i], 10);
    });
  });
  it('Uc = 25, Uv = 1.2, η = 0.18', () => {
    termFx.poa.forEach((g: number, i: number) => {
      const tc = temperaturaCelda(g, termFx.ta[i], termFx.ws[i], { Uc: 25, Uv: 1.2, absortancia: 0.9 }, 0.18);
      expect(tc).toBeCloseTo(termFx.tc_25_12[i], 10);
    });
  });
});

describe('Modelo de un diodo CEC (vs pvlib calcparams_cec + singlediode)', () => {
  for (const caso of diodoFx) {
    const m = modulos.find((x) => x.id === caso.id)!;
    it(`${m.fabricante} ${m.modelo}: Pmp, Voc, Isc con error relativo < 1e-6`, () => {
      const eg = bandaProhibida(m.tecnologia);
      caso.g.forEach((g: number, i: number) => {
        const c = calcParamsCEC(g, caso.t[i], { ...m.cec, ...eg });
        expect(c.IL / caso.IL[i]).toBeCloseTo(1, 10);
        expect(c.I0 / caso.I0[i]).toBeCloseTo(1, 8);
        const r = resolverUnDiodo(c);
        expect(Math.abs(r.pmp / caso.pmp[i] - 1)).toBeLessThan(1e-6);
        expect(Math.abs(r.voc / caso.voc[i] - 1)).toBeLessThan(1e-6);
        expect(Math.abs(r.isc / caso.isc[i] - 1)).toBeLessThan(1e-6);
        expect(Math.abs(r.vmp / caso.vmp[i] - 1)).toBeLessThan(1e-3);
        expect(Math.abs(corrienteAVoltaje(caso.v06[i], c) - caso.i06[i])).toBeLessThan(1e-6);
      });
    });
  }
  it('a STC reproduce la potencia nominal de la ficha (±1.5 %)', () => {
    for (const m of modulos) {
      const r = resolverUnDiodo(calcParamsCEC(1000, 25, { ...m.cec, ...bandaProhibida(m.tecnologia) }));
      expect(Math.abs(r.pmp / m.pNom! - 1)).toBeLessThan(0.015);
    }
  });
});

describe('Inversor Sandia (vs pvlib.inverter.sandia)', () => {
  for (const caso of sandiaFx) {
    const inv = inversores.find((x) => x.id === caso.id)!;
    it(`${inv.fabricante} ${inv.modelo}`, () => {
      caso.pdc.forEach((p: number, i: number) => {
        const r = inversorSandia(p, caso.vdc[i], inv.sandia);
        if (p < inv.sandia.Pso) expect(r.pac).toBe(0); // pvlib devuelve −Pnt (consumo nocturno, se reporta aparte)
        else expect(r.pac).toBeCloseTo(caso.pac[i], 6);
      });
    });
  }
});
