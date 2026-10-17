/** Control de calidad, NASA (relleno, LST, preliminar), exclusiones, horizonte de PVGIS y trayectorias solares. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { calidadAnio, mesesAtipicos, nocturnasPorMes } from './calidad';
import { analizar, promedioHorario } from './variabilidad';
import { leerNASAJson, rotarALocal } from './lectores';
import { leerHorizontePVGIS } from './servicio';
import { MES_DE_HORA } from '@/engine/calendario';
import { horasBloqueadas, prepararPerfil, trayectoriaSolar } from '@/engine/horizonte/horizonte';
import type { DatosClima, SerieAnual } from '@/engine/tipos';

const base: DatosClima = JSON.parse(readFileSync(new URL('../../public/data/ibarra-sintetico.json', import.meta.url), 'utf8'));
const pad = (n: number) => String(n).padStart(2, '0');

/** JSON de NASA POWER con la estructura real (header, messages, properties.parameter). */
function nasaJSON(anio: number, opciones: { factorMes?: Record<number, number>; relleno?: number; huecos?: number[]; lst?: boolean; fuentes?: string[] } = {}) {
  // en UTC: rotar local → UTC (+5 h); en LST la hora es la local (UTC−5)
  const rot = (v: number[]) => (opciones.lst ? v : rotarALocal(v, 5));
  const g = rot(base.ghi), n = rot(base.dni), d = rot(base.dhi), t = rot(base.tamb), w = rot(base.viento);
  const P: Record<string, Record<string, number>> = { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DNI: {}, ALLSKY_SFC_SW_DIFF: {}, T2M: {}, WS10M: {} };
  const relleno = opciones.relleno ?? -999;
  for (let i = 0; i < 8760; i++) {
    const dt = new Date(Date.UTC(anio, 0, 1) + i * 3600e3);
    const k = `${anio}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}${pad(dt.getUTCHours())}`;
    const f = opciones.factorMes?.[dt.getUTCMonth()] ?? 1;
    const hueco = opciones.huecos?.includes(i);
    P.ALLSKY_SFC_SW_DWN[k] = hueco ? relleno : g[i] * f;
    P.ALLSKY_SFC_SW_DNI[k] = hueco ? relleno : n[i] * f;
    P.ALLSKY_SFC_SW_DIFF[k] = hueco ? relleno : d[i] * f;
    P.T2M[k] = hueco ? relleno : t[i];
    P.WS10M[k] = w[i];
  }
  return {
    type: 'Feature', geometry: { type: 'Point', coordinates: [-78.12, 0.35, 2510] }, properties: { parameter: P },
    header: { title: 'NASA/POWER Source Native Resolution Hourly Data', fill_value: relleno, time_standard: opciones.lst ? 'LST' : 'UTC', sources: opciones.fuentes ?? ['syn1deg', 'merra2'], start: `${anio}0101`, end: `${anio}1231` },
    messages: [],
  };
}

describe('NASA POWER: relleno, referencia horaria y datos preliminares', () => {
  it('usa el valor de relleno declarado en el header y cuenta las horas faltantes', () => {
    const huecos = [4000, 4001, 4002];
    const { clima } = leerNASAJson(nasaJSON(2023, { relleno: -888, huecos }));
    expect(clima.calidad?.faltantes.ghi).toBe(3);
    expect(clima.calidad?.faltantes.tamb).toBe(3);
    expect(Math.min(...clima.ghi)).toBeGreaterThanOrEqual(0);
    expect(Math.min(...clima.tamb)).toBeGreaterThan(-50); // interpolada, no −888
    const q = calidadAnio(clima, 2023, new Date(Date.UTC(2026, 9, 17)));
    expect(q.horasValidasPct).toBeCloseTo((1 - 3 / 8760) * 100, 6);
  });
  it('datos en LST se convierten correctamente a la hora local', () => {
    const utc = leerNASAJson(nasaJSON(2023)).clima;
    const lst = leerNASAJson(nasaJSON(2023, { lst: true }));
    expect(lst.clima.ghi).toEqual(utc.ghi);
    expect(lst.avisos.some((a) => a.includes('LST'))).toBe(true);
  });
  it('marca como preliminar si NASA declara FLASHFlux o el año es reciente', () => {
    const c = leerNASAJson(nasaJSON(2023, { fuentes: ['flashflux', 'merra2'] })).clima;
    expect(c.calidad?.preliminar).toBe(true);
    const viejo = leerNASAJson(nasaJSON(2023)).clima;
    expect(calidadAnio(viejo, 2023, new Date(Date.UTC(2026, 9, 17))).preliminar).toBe(false);
    expect(calidadAnio({ ...viejo, anioDatos: 2025 }, 2025, new Date(Date.UTC(2026, 9, 17))).preliminar).toBe(true);
  });
});

describe('control de calidad', () => {
  it('sin observaciones en el año sintético bien alineado', () => {
    const q = calidadAnio({ ...base, fuente: 'nasa-power' }, 2021, new Date(Date.UTC(2026, 9, 17)));
    expect(q.nocturnas).toBe(0);
    expect(q.fueraDeRango.total).toBe(0);
    expect(q.estado).toBe('ok');
  });
  it('detecta irradiancia nocturna cuando la serie está desfasada (error de huso horario)', () => {
    const desfasado = { ...base, ghi: rotarALocal(base.ghi, 6), dni: rotarALocal(base.dni, 6), dhi: rotarALocal(base.dhi, 6) };
    const q = calidadAnio(desfasado, 2021);
    expect(q.nocturnas).toBeGreaterThan(500);
    expect(q.estado).toBe('error');
    expect(nocturnasPorMes(desfasado).every((n) => n > 0)).toBe(true);
  });
  it('detecta valores fuera de los límites físicos BSRN', () => {
    const ghi = base.ghi.slice();
    const i = base.ghi.indexOf(Math.max(...base.ghi));
    ghi[i] = 2500;
    expect(calidadAnio({ ...base, ghi }, 2021).fueraDeRango.ghi).toBe(1);
  });
});

describe('meses atípicos (dejando un año fuera)', () => {
  const anio = (a: number, f: number, mes?: number, fm = 1): SerieAnual => ({
    fuente: 'nasa-power', anio: a,
    clima: { ...base, anioDatos: a, ghi: base.ghi.map((x, i) => x * f * (MES_DE_HORA[i] === mes ? fm : 1)), dni: base.dni, dhi: base.dhi },
  });
  const series = [anio(2021, 1.0), anio(2022, 0.97), anio(2023, 1.02), anio(2024, 0.99), anio(2025, 1.01, 11, 1.22)];
  it('diciembre 2025 a +22 % se marca como atípico', () => {
    const at = mesesAtipicos(series);
    expect(at[0].anio).toBe(2025);
    expect(at[0].mes).toBe(11);
    expect(at[0].z).toBeGreaterThan(2);
    expect(at[0].diferencia).toBeGreaterThan(0.2);
  });
  it('con la σ de todos los años (sin dejar fuera) nunca superaría 2σ con 5 años', () => {
    const v = [100, 100, 100, 100, 122];
    const m = v.reduce((a, b) => a + b, 0) / 5;
    const s = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / 4);
    expect((122 - m) / s).toBeLessThan(2); // (n−1)/√n = 1.79
  });
  it('excluir el mes lo quita del promedio mensual e imputa la GHI anual', () => {
    const sin = analizar(series);
    const con = analizar(series, 0, [{ anio: 2025, mes: 11 }]);
    expect(con.promedioMensual[11]).toBeLessThan(sin.promedioMensual[11]);
    const a25 = con.anios.find((x) => x.anio === 2025)!;
    expect(a25.mesesExcluidos).toEqual([11]);
    const esperado = a25.ghiMensual.reduce((s, g, m) => s + (m === 11 ? con.promedioMensual[11] : g), 0);
    expect(a25.ghiAnual).toBeCloseTo(esperado, 9);
    // promedio horario sin diciembre 2025
    const ph = promedioHorario(series.map((s) => s.clima), [{ anio: 2025, mes: 11 }]);
    const dicH = ph.ghi.reduce((s, x, i) => s + (MES_DE_HORA[i] === 11 ? x : 0), 0) / 1000;
    expect(dicH).toBeCloseTo(con.promedioMensual[11], 0);
    expect(ph.descripcion).toContain('1 mes(es) excluido(s)');
  });
});

describe('horizonte de PVGIS y trayectorias solares', () => {
  it('lee printhorizon (A: 0 = sur) y quita el punto duplicado de +180', () => {
    const perfil = Array.from({ length: 49 }, (_, k) => ({ A: -180 + k * 7.5, H_hor: k % 2 ? 6.1 : 4.2 }));
    const j = { inputs: { location: { latitude: 0.35, longitude: -78.12, elevation: 2225 } }, outputs: { horizon_profile: perfil }, meta: {} };
    const pts = leerHorizontePVGIS(j);
    expect(pts).toHaveLength(48);
    expect(pts[0]).toEqual({ azimut: -180, altura: 4.2 });
    expect(() => leerHorizontePVGIS({ outputs: {} })).toThrow(/horizon_profile/);
  });
  it('trayectoria del equinoccio en Ibarra: el sol pasa casi por el cenit al mediodía solar', () => {
    const tr = trayectoriaSolar(2025, 3, 20, { latitud: 0.35, longitud: -78.12, altitud: 2225 }, -5);
    const pts = tr.flat();
    const max = pts.reduce((a, b) => (b.elevacion > a.elevacion ? b : a));
    expect(max.elevacion).toBeGreaterThan(88);
    expect(max.horaLocal).toBeGreaterThan(12);
    expect(max.horaLocal).toBeLessThan(12.6); // mediodía solar ≈ 12:20 (longitud −78.12°, ecuación del tiempo)
  });
  it('el 21 de junio el sol va por el norte (azimut cerca de ±180°) y la trayectoria se parte en tramos', () => {
    const tr = trayectoriaSolar(2025, 6, 21, { latitud: 0.35, longitud: -78.12, altitud: 2225 }, -5);
    expect(tr.length).toBeGreaterThan(1);
    const mediodia = tr.flat().reduce((a, b) => (b.elevacion > a.elevacion ? b : a));
    expect(Math.abs(mediodia.azimut)).toBeGreaterThan(170);
    expect(mediodia.elevacion).toBeCloseTo(90 - (23.44 - 0.35), 0); // 90° − |φ − δ|
  });
  it('horizonte uniforme de 10°: ≈ 1.3 h tapadas en el equinoccio (sol sube ~15°/h)', () => {
    const tr = trayectoriaSolar(2025, 3, 20, { latitud: 0.35, longitud: -78.12, altitud: 2225 }, -5, 5);
    const h = horasBloqueadas(tr, prepararPerfil({ origen: 'usuario', puntos: [{ azimut: 0, altura: 10 }] }), 5);
    expect(h).toBeGreaterThan(1.1);
    expect(h).toBeLessThan(1.6);
  });
});
