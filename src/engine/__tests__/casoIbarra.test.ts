/**
 * Caso de prueba Ibarra: cadena completa (8760 h) de la app vs. la misma cadena en pvlib.
 * Clima sintético reproducible (public/data/ibarra-sintetico.json); referencia en fixtures/casoIbarra.json.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { simular } from '../simular';
import { SIN_HORIZONTE } from '../horizonte/horizonte';
import { BIFACIAL_POR_DEFECTO } from '../bifacial/bifacial';
import { PERDIDAS_POR_DEFECTO, type DatosClima, type EntradaSimulacion, type InversorRed, type Modulo } from '../tipos';
import modulos from '../../catalogo/semilla/modulosCEC.json';
import inversores from '../../catalogo/semilla/inversoresCEC.json';
import ref from './fixtures/casoIbarra.json';

const clima: DatosClima = JSON.parse(readFileSync(new URL('../../../public/data/ibarra-sintetico.json', import.meta.url), 'utf8'));

function entrada(): EntradaSimulacion {
  const s = ref.sistema;
  return {
    clima,
    carga: new Array(8760).fill(400),
    generador: {
      modulo: modulos.find((m) => m.id === s.modulo) as Modulo,
      modeloModulo: 'cec',
      nSerie: s.nSerie,
      nParalelo: s.nParalelo,
      inclinacion: s.inclinacion,
      azimut: s.azimut,
      albedo: new Array(12).fill(s.albedo),
      termico: { montaje: 'suelo', Uc: s.Uc, Uv: s.Uv, absortancia: 0.9 },
      iam: { tipo: 'ashrae', b0: s.b0 },
      horizonte: SIN_HORIZONTE,
      bifacial: BIFACIAL_POR_DEFECTO,
      perdidas: { ...PERDIDAS_POR_DEFECTO, ...s.perdidas, degradacionAnual: 0, anioOperacion: 1, sombraDirecta: 0, sombraDifusa: 0 },
    },
    sistema: { tipo: 'on-grid', inversor: inversores.find((x) => x.id === s.inversor) as InversorRed, nInversores: s.nInversores, modalidad: 'autoconsumo' },
  };
}

describe('Caso Ibarra — cadena completa vs pvlib', () => {
  const r = simular(entrada());

  it('irradiación anual (GHI, POA, efectiva) con error < 0.01 %', () => {
    expect(Math.abs(r.anual.ghi / ref.anual.ghi - 1)).toBeLessThan(1e-4);
    expect(Math.abs(r.anual.poa / ref.anual.poa - 1)).toBeLessThan(1e-4);
    const efectiva = r.mensual.reduce((a, m) => a + m.efectiva, 0);
    expect(Math.abs(efectiva / ref.anual.efectiva - 1)).toBeLessThan(1e-4);
  });

  it('energía DC y AC anual con error < 0.05 %', () => {
    expect(Math.abs(r.anual.eDC / ref.anual.eDC - 1)).toBeLessThan(5e-4);
    expect(Math.abs(r.anual.eSalida / ref.anual.eAC - 1)).toBeLessThan(5e-4);
  });

  it('energía AC mensual con error < 0.1 %', () => {
    r.mensual.forEach((m, i) => expect(Math.abs(m.eSalida / ref.mensual.eAC[i] - 1)).toBeLessThan(1e-3));
  });

  it('valores horarios de muestra (POA, Tcelda, P_DC, P_AC)', () => {
    ref.muestras.horas.forEach((h: number, k: number) => {
      expect(r.horario.poa[h]).toBeCloseTo(ref.muestras.poa[k], 1);
      expect(r.horario.tCelda[h]).toBeCloseTo(ref.muestras.tc[k], 2);
      expect(Math.abs(r.horario.pDC[h] - ref.muestras.pDC[k])).toBeLessThan(0.5);
      expect(Math.abs(r.horario.pSalida[h] - ref.muestras.pAC[k])).toBeLessThan(0.5);
    });
  });

  it('rendimiento específico y PR coinciden', () => {
    expect(r.anual.rendimientoEspecifico).toBeCloseTo(ref.anual.rendimiento, 0);
    expect(r.anual.pr).toBeCloseTo(ref.anual.pr, 3);
  });

  it('la cascada de pérdidas es coherente (cada paso parte del anterior y termina en la energía a la red)', () => {
    const ultimo = r.cascada[r.cascada.length - 1];
    expect(ultimo.clave).toBe('eRed');
    expect(ultimo.valor).toBeCloseTo(r.anual.eSalida, 3);
    const dc = r.cascada.find((p) => p.clave === 'trasOhmicaDC')!;
    expect(dc.valor).toBeCloseTo(r.anual.eDC, 3);
  });

  it('balance energético on-grid: autoconsumo + inyección = producción; autoconsumo + compra = carga', () => {
    expect(r.anual.autoconsumo + r.anual.inyeccion).toBeCloseTo(r.anual.eSalida, 3);
    expect(r.anual.autoconsumo + r.anual.compra).toBeCloseTo(r.anual.carga, 3);
  });

  it('simula 8760 h en menos de 2 s', () => {
    expect(r.duracionMs).toBeLessThan(2000);
  });
});
