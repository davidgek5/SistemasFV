/** Variabilidad interanual, P50/P90, peor mes/año, promedio horario, lector PVGIS seriescalc, esquema v2 y datos de simulación. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analizar, compararMensual, desviacion, excedencia, media, promedioHorario, redondearClima, Z_P90 } from './variabilidad';
import { leerArchivoClima, leerPVGISSerieJson, rotarALocal } from './lectores';
import { posicionSolar } from '@/engine/solar/spa';
import { MES_DE_HORA } from '@/engine/calendario';
import type { DatosClima, SerieAnual } from '@/engine/tipos';
import { migrar, validarProyecto } from '@/proyecto/esquema';
import { proyectoNuevo } from '@/proyecto/porDefecto';
import { climaParaSimular, entradaDesdeProyecto } from '@/proyecto/entrada';
import { GET as proxySerie } from '../../api/pvgis-serie';

const base: DatosClima = JSON.parse(readFileSync(new URL('../../public/data/ibarra-sintetico.json', import.meta.url), 'utf8'));

/** Año sintético: escala la irradiancia por un factor anual y, opcionalmente, un mes concreto. */
function anio(a: number, factor: number, mesBajo?: number, factorMes = 1): SerieAnual {
  const f = (i: number) => factor * (MES_DE_HORA[i] === mesBajo ? factorMes : 1);
  return {
    fuente: 'nasa-power', anio: a,
    clima: { ...base, fuente: 'nasa-power', anioDatos: a, ghi: base.ghi.map((x, i) => x * f(i)), dni: base.dni.map((x, i) => x * f(i)), dhi: base.dhi.map((x, i) => x * f(i)), tamb: base.tamb.map((t) => t + (factor - 1) * 10) },
  };
}

describe('estadística básica', () => {
  it('media y desviación muestral', () => {
    expect(media([2, 4, 4, 4, 5, 5, 7, 9])).toBe(5);
    expect(desviacion([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(desviacion([5])).toBe(0);
  });
  it('P50/P90 normales', () => {
    const v = [1700, 1750, 1800, 1850, 1900];
    const e = excedencia(v);
    const s = desviacion(v);
    expect(e.p50).toBe(1800);
    expect(e.p90).toBeCloseTo(1800 - Z_P90 * s, 9);
    expect(e.p90Decenal).toBeCloseTo(1800 - Z_P90 * s / Math.sqrt(10), 9);
    expect(e.cv).toBeCloseTo(s / 1800, 12);
    // con incertidumbre del dato de 5 %: σ_total = √(σ² + (0.05·μ)²)
    const e5 = excedencia(v, 0.05);
    expect(e5.sigmaTotal).toBeCloseTo(Math.hypot(s, 90), 9);
    expect(e5.p90).toBeLessThan(e.p90);
  });
  it('Z del P90 = cuantil 10 % de la normal estándar', () => {
    // Φ(−1.28155) ≈ 0.10 (aproximación de Abramowitz-Stegun 26.2.17)
    const phi = (x: number) => { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; };
    expect(phi(-Z_P90)).toBeCloseTo(0.1, 6);
  });
});

describe('análisis multianual', () => {
  const series = [anio(2021, 1.0), anio(2022, 0.94, 5, 0.7), anio(2023, 1.05), anio(2024, 0.98), anio(2025, 1.03)];
  const a = analizar(series);
  it('GHI anual por año y peor/mejor año', () => {
    const g0 = base.ghi.reduce((s, x) => s + x, 0) / 1000;
    expect(a.anios[0].ghiAnual).toBeCloseTo(g0, 6);
    expect(a.peorAnio.anio).toBe(2022);
    expect(a.mejorAnio.anio).toBe(2023);
    expect(a.ghi.n).toBe(5);
  });
  it('peor mes = junio 2022 (reducido al 70 %)', () => {
    expect(a.peorMes.anio).toBe(2022);
    expect(a.peorMes.mes).toBe(5);
  });
  it('promedio mensual = media de los años', () => {
    expect(a.promedioMensual[0]).toBeCloseTo(media(a.anios.map((x) => x.ghiMensual[0])), 9);
    expect(a.desviacionMensual[5]).toBeGreaterThan(a.desviacionMensual[0]);
  });
  it('promedio horario de años idénticos = el mismo año; GHI anual = media', () => {
    const p1 = promedioHorario([base, base, base]);
    expect(p1.ghi).toEqual(redondearClima(base).ghi);
    const p = promedioHorario(series.map((s) => s.clima));
    expect(p.ghi.reduce((s, x) => s + x, 0) / 1000).toBeCloseTo(a.ghi.media, 0);
    expect(p.fuente).toBe('promedio');
    expect(p.descripcion).toContain('2021–2025');
  });
  it('comparación mensual de fuentes', () => {
    const c = compararMensual([100, 200], [110, 180]);
    expect(c.filas[0].diferencia).toBeCloseTo(0.1, 12);
    expect(c.filas[1].diferencia).toBeCloseTo(-0.1, 12);
    expect(c.diferenciaAnual).toBeCloseTo(-10 / 300, 12);
  });
});

describe('PVGIS seriescalc', () => {
  it('lee GHI/DHI y reconstruye la DNI con H_sun', () => {
    const local = base;
    const aUTC = (v: number[]) => rotarALocal(v, 5);
    const ghi = aUTC(local.ghi), dhi = aUTC(local.dhi), ta = aUTC(local.tamb), ws = aUTC(local.viento);
    const pad = (n: number) => String(n).padStart(2, '0');
    const filas = ghi.map((_, i) => {
      const t = Date.UTC(2019, 0, 1) + i * 3600e3;
      const d = new Date(t);
      const h = posicionSolar(t / 1000 + 600, { latitud: 0.35, longitud: -78.12, altitud: 2225 }).elevacion;
      const gbH = Math.max(0, ghi[i] - dhi[i]);
      return { time: `2019${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}:${pad(d.getUTCHours())}10`, 'Gb(i)': gbH, 'Gd(i)': dhi[i], 'Gr(i)': 0, H_sun: Math.max(0, h), T2m: ta[i], WS10m: ws[i], Int: 0 };
    });
    const j = { inputs: { location: { latitude: 0.35, longitude: -78.12, elevation: 2225 }, meteo_data: { radiation_db: 'PVGIS-SARAH3' } }, outputs: { hourly: filas } };
    const { clima } = leerPVGISSerieJson(j);
    expect(clima.fuente).toBe('pvgis-serie');
    expect(clima.anioDatos).toBe(2019);
    expect(clima.desfaseSolarHoras).toBeCloseTo(10 / 60, 9);
    clima.ghi.forEach((g, i) => expect(g).toBeCloseTo(local.ghi[i], 6));
    const sumaDni = clima.dni.reduce((s, x) => s + x, 0);
    const refDni = local.dni.reduce((s, x) => s + x, 0);
    expect(Math.abs(sumaDni / refDni - 1)).toBeLessThan(0.05); // DNI reconstruida (H_sun a hh:10)
    expect(leerArchivoClima('serie.json', JSON.stringify(j)).clima.fuente).toBe('pvgis-serie');
  });
  it('proxy rechaza años fuera de 2005–2023', async () => {
    expect((await proxySerie(new Request('http://x/api/pvgis-serie?lat=0.35&lon=-78.12&anio=2024'))).status).toBe(400);
    expect((await proxySerie(new Request('http://x/api/pvgis-serie?lat=0.35&lon=-78.12&anio=2004'))).status).toBe(400);
  });
});

describe('esquema v2 y datos de simulación', () => {
  it('migra un proyecto v1', () => {
    const v1 = { ...proyectoNuevo(), schemaVersion: 1 } as Record<string, unknown>;
    delete v1.seriesAnuales;
    delete v1.datosSimulacion;
    const m = migrar(v1) as Record<string, unknown>;
    expect(m.schemaVersion).toBe(3);
    expect((m.datosSimulacion as { incertidumbre: Record<string, number> }).incertidumbre).toEqual({ 'nasa-power': 0.05, 'pvgis-serie': 0.04 });
    expect(m.exclusiones).toEqual([]);
    expect(m.seriesAnuales).toEqual([]);
    const p = validarProyecto(JSON.parse(JSON.stringify(v1)));
    expect(p.datosSimulacion.modo).toBe('principal');
  });
  it('elige el clima según el modo', () => {
    const p = proyectoNuevo();
    p.clima = base;
    p.seriesAnuales = [anio(2021, 1), anio(2022, 0.9), anio(2023, 1.1)];
    expect(climaParaSimular(p).clima).toBe(base);
    p.datosSimulacion = { modo: 'anio', fuente: 'nasa-power', anio: 2022, incertidumbre: { 'nasa-power': 0.05, 'pvgis-serie': 0.04 } };
    expect(climaParaSimular(p).clima.anioDatos).toBe(2022);
    p.datosSimulacion.modo = 'promedio';
    const prom = climaParaSimular(p).clima;
    expect(prom.fuente).toBe('promedio');
    expect(prom.ghi.reduce((s, x) => s + x, 0)).toBeCloseTo(base.ghi.reduce((s, x) => s + x, 0), -2);
    p.datosSimulacion.fuente = 'pvgis-serie';
    expect(() => climaParaSimular(p)).toThrow(/PVGIS/);
    expect(entradaDesdeProyecto({ ...p, datosSimulacion: { ...p.datosSimulacion, modo: 'principal' } }).clima).toBe(base);
  });
});
