/** Tests de perfil de carga, horizonte, batería, off-grid, strings y dimensionamiento. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { generarCarga, horasFranja } from '../carga/perfil';
import { alturaHorizonte, factorDifusaHorizonte, prepararPerfil, solBloqueado } from '../horizonte/horizonte';
import { cargar, crearEstadoBanco, descargar, soc } from '../bateria/balance';
import { simular } from '../simular';
import { SIN_HORIZONTE } from '../horizonte/horizonte';
import { BIFACIAL_POR_DEFECTO } from '../bifacial/bifacial';
import { CRITERIOS_POR_DEFECTO, rangoSerie, validarStrings } from '../dimensionamiento/strings';
import { proponerOffGrid, proponerOnGrid } from '../dimensionamiento/automatico';
import { PERDIDAS_POR_DEFECTO, type Bateria, type DatosClima, type Generador, type InversorAislado, type InversorRed, type Modulo, type Regulador } from '../tipos';
import modulos from '../../catalogo/semilla/modulosCEC.json';
import inversores from '../../catalogo/semilla/inversoresCEC.json';
import baterias from '../../catalogo/semilla/baterias.json';
import reguladores from '../../catalogo/semilla/reguladores.json';
import aislados from '../../catalogo/semilla/inversoresAislados.json';

const clima: DatosClima = JSON.parse(readFileSync(new URL('../../../public/data/ibarra-sintetico.json', import.meta.url), 'utf8'));
const jinko = modulos[0] as Modulo;
const primo50 = inversores.find((i) => i.id.includes('primo-50')) as InversorRed;

const generadorBase = (nSerie: number, nParalelo: number, extra: Partial<Generador> = {}): Generador => ({
  modulo: jinko, modeloModulo: 'cec', nSerie, nParalelo, inclinacion: 10, azimut: 0, albedo: new Array(12).fill(0.2),
  termico: { montaje: 'suelo', Uc: 29, Uv: 0, absortancia: 0.9 }, iam: { tipo: 'ashrae', b0: 0.05 },
  horizonte: SIN_HORIZONTE, bifacial: BIFACIAL_POR_DEFECTO, perdidas: { ...PERDIDAS_POR_DEFECTO }, ...extra,
});

describe('Perfil de carga', () => {
  it('franja que cruza la medianoche', () => {
    expect(horasFranja({ inicio: 22, fin: 2 })).toEqual([22, 23, 0, 1]);
    expect(horasFranja({ inicio: 0, fin: 24 })).toHaveLength(24);
  });
  it('energía diaria, pico simultáneo y arranque', () => {
    const { estadisticas: e, serie } = generarCarga({
      modo: 'equipos',
      equipos: [
        { id: '1', nombre: 'Focos', potencia: 10, cantidad: 6, horasLaborable: 5, horasFinDeSemana: 6, inicio: 18, fin: 24, factorArranque: 1 },
        { id: '2', nombre: 'Refrigeradora', potencia: 150, cantidad: 1, horasLaborable: 10, horasFinDeSemana: 10, inicio: 0, fin: 24, factorArranque: 4 },
        { id: '3', nombre: 'Bomba', potencia: 750, cantidad: 1, horasLaborable: 1, horasFinDeSemana: 0, inicio: 7, fin: 9, factorArranque: 5 },
      ],
    }, 2025);
    expect(e.energiaDiariaLaborable).toBeCloseTo(60 * 5 + 1500 + 750, 6);
    expect(e.energiaDiariaFinDeSemana).toBeCloseTo(60 * 6 + 1500, 6);
    expect(e.potenciaPicoSimultanea).toBe(900); // bomba + refri (7–9 h)
    expect(e.potenciaArranque).toBe(900 + 4 * 750);
    expect(serie.reduce((a, b) => a + b, 0) / 1000).toBeCloseTo(e.energiaAnual, 6);
    // 2025: 261 días laborables y 104 de fin de semana
    expect(e.energiaAnual).toBeCloseTo((261 * 2550 + 104 * 1860) / 1000, 6);
  });
  it('modo mensual respeta los kWh de cada mes', () => {
    const mensual = [180, 170, 175, 172, 180, 178, 185, 190, 182, 179, 176, 200];
    const { serie } = generarCarga({ modo: 'mensual', consumoMensualKWh: mensual, perfil: 'residencial' }, 2025);
    let i = 0;
    const dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    dias.forEach((d, m) => {
      const s = serie.slice(i, i + d * 24).reduce((a, b) => a + b, 0) / 1000;
      expect(s).toBeCloseTo(mensual[m], 6);
      i += d * 24;
    });
  });
});

describe('Horizonte lejano', () => {
  const perfil = prepararPerfil({ origen: 'usuario', puntos: [{ azimut: -90, altura: 20 }, { azimut: 0, altura: 5 }, { azimut: 90, altura: 10 }, { azimut: 180, altura: 0 }] });
  it('interpolación circular', () => {
    expect(alturaHorizonte(perfil, -45)).toBeCloseTo(12.5, 9);
    expect(alturaHorizonte(perfil, -135)).toBeCloseTo(10, 9); // entre 180 (0°) y −90 (20°)
    expect(alturaHorizonte(perfil, 270)).toBeCloseTo(20, 9);
  });
  it('bloqueo del sol', () => {
    expect(solBloqueado(perfil, 15, -90)).toBe(true);
    expect(solBloqueado(perfil, 25, -90)).toBe(false);
  });
  it('factor de difusa: 1 sin horizonte, horizonte uniforme de 10° en plano horizontal = cos²(10°)', () => {
    expect(factorDifusaHorizonte(SIN_HORIZONTE, 10, 0)).toBe(1);
    const uniforme = prepararPerfil({ origen: 'usuario', puntos: [{ azimut: 0, altura: 10 }] });
    // ∫_{10°}^{90°} sinθ cosθ dθ / ∫_0^{90°} = 1 − sin²(10°)
    expect(factorDifusaHorizonte(uniforme, 0, 0)).toBeCloseTo(1 - Math.sin((10 * Math.PI) / 180) ** 2, 3);
  });
  it('un horizonte alto reduce la producción', () => {
    const base = simular({ clima, carga: new Array(8760).fill(0), generador: generadorBase(10, 1), sistema: { tipo: 'on-grid', inversor: primo50, nInversores: 1, modalidad: 'autoconsumo' } });
    const conH = simular({
      clima, carga: new Array(8760).fill(0),
      generador: generadorBase(10, 1, { horizonte: { origen: 'usuario', puntos: [{ azimut: -90, altura: 25 }, { azimut: 90, altura: 25 }, { azimut: 0, altura: 15 }, { azimut: 180, altura: 15 }] } }),
      sistema: { tipo: 'on-grid', inversor: primo50, nInversores: 1, modalidad: 'autoconsumo' },
    });
    expect(conH.anual.eSalida).toBeLessThan(base.anual.eSalida * 0.95);
    const paso = conH.cascada.find((p) => p.clave === 'trasHorizonte')!;
    expect(paso.variacion).toBeLessThan(-0.03);
  });
});

describe('Batería', () => {
  const b = baterias.find((x) => x.id === 'pylontech-us5000') as Bateria;
  it('respeta SOC mínimo/máximo y eficiencias', () => {
    const e = crearEstadoBanco({ bateria: b, nSerie: 1, nParalelo: 2, socMin: 0.1, socMax: 1, socInicial: 0.5 });
    expect(e.capacidadWh).toBe(9600);
    const tomado = cargar(e, 20000);
    expect(soc(e)).toBeLessThanOrEqual(1 + 1e-12);
    expect(tomado).toBeLessThanOrEqual(e.pCargaMaxW + 1e-9);
    for (let k = 0; k < 20; k++) descargar(e, 5000);
    expect(soc(e)).toBeCloseTo(0.1, 9);
  });
});

describe('Sistema off-grid', () => {
  const banco = { bateria: baterias.find((x) => x.id === 'pylontech-us5000') as Bateria, nSerie: 1, nParalelo: 2, socMin: 0.1, socMax: 1, socInicial: 1 };
  const sistema = {
    tipo: 'off-grid' as const, banco, regulador: reguladores.find((r) => r.id === 'victron-250-100') as Regulador, nReguladores: 1,
    inversor: aislados.find((i) => i.id === 'growatt-spf5000es') as InversorAislado,
  };
  const carga = new Array(8760).fill(0).map((_, i) => ((i % 24) >= 18 && (i % 24) < 23 ? 600 : 150));
  const r = simular({ clima, carga, generador: generadorBase(3, 2), sistema });

  it('balance: carga = servida + no suministrada', () => {
    expect(r.anual.eSalida + r.anual.noSuministrada).toBeCloseTo(r.anual.carga, 3);
  });
  it('SOC dentro de los límites y fracción solar alta', () => {
    for (const s of r.horario.soc) {
      expect(s).toBeGreaterThanOrEqual(0.1 - 1e-6);
      expect(s).toBeLessThanOrEqual(1 + 1e-6);
    }
    expect(r.anual.fraccionSolar).toBeGreaterThan(0.95);
    expect(r.anual.ciclosBateria).toBeGreaterThan(50);
  });
  it('cascada off-grid: termina en la energía entregada a la carga', () => {
    const ultimo = r.cascada[r.cascada.length - 1];
    expect(ultimo.clave).toBe('aCarga');
    expect(ultimo.valor).toBeCloseTo(r.anual.eSalida, 3);
  });
  it('banco pequeño genera déficit', () => {
    const chico = simular({ clima, carga: carga.map((x) => x * 4), generador: generadorBase(3, 1), sistema: { ...sistema, banco: { ...banco, nParalelo: 1 } } });
    expect(chico.anual.noSuministrada).toBeGreaterThan(0);
    expect(chico.anual.diasConDeficit).toBeGreaterThan(0);
  });
});

describe('Strings y dimensionamiento', () => {
  it('rango de módulos en serie y validación', () => {
    const r = rangoSerie(jinko, primo50, { ...CRITERIOS_POR_DEFECTO, tAmbMin: 2 });
    expect(r.nMin).toBeGreaterThanOrEqual(1);
    expect(r.nMax).toBeGreaterThanOrEqual(r.nMin);
    const v = validarStrings(jinko, primo50, r.nMax + 1, 1, 1, { ...CRITERIOS_POR_DEFECTO, tAmbMin: 2 });
    expect(v.some((x) => x.estado === 'error')).toBe(true);
    const ok = validarStrings(jinko, { ...primo50, vdcMaxEntrada: 1000, idcMaxEntrada: 36 }, r.nMax, 1, 1, { ...CRITERIOS_POR_DEFECTO, tAmbMin: 2 });
    expect(ok.find((x) => x.clave === 'vocMax')!.estado).not.toBe('error');
  });
  it('propuesta on-grid cercana al objetivo', () => {
    const p = proponerOnGrid(8000, 4.8, jinko, inversores as InversorRed[], { ...CRITERIOS_POR_DEFECTO, tAmbMin: 2 });
    expect(p.inversor).not.toBeNull();
    expect(p.nModulos * jinko.pNom / 1000).toBeGreaterThan(p.potenciaObjetivoKWp * 0.8);
    expect(p.relacionDCAC).toBeGreaterThan(0.7);
  });
  it('propuesta off-grid', () => {
    const p = proponerOffGrid({
      energiaDiariaWh: 4500, hspPlanoMesCritico: 4.2, potenciaPicoCargaW: 1800, potenciaArranqueW: 4000, diasAutonomia: 2, modulo: jinko,
      baterias: baterias as Bateria[], reguladores: reguladores as Regulador[], inversores: aislados as InversorAislado[], tAmbMin: 2, quimica: 'LiFePO4',
    });
    expect(p.voltajeSistema).toBe(24);
    expect(p.inversor?.voltajeBateria).toBe(24);
    expect(p.bateriasSerie * p.bateriasParalelo).toBeGreaterThan(0);
    expect(p.capacidadRequeridaWh).toBeGreaterThan(4500 * 2);
  });
});
