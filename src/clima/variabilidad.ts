/**
 * Análisis multianual de datos meteorológicos: estadísticas por año, variabilidad interanual,
 * P50/P90 de irradiación, peor mes / peor año, promedio multianual y comparación de fuentes.
 * Método documentado en MODELOS.md §18.
 */
import { DIAS_MES } from '@/engine/calendario';
import { HORAS_ANIO, type DatosClima } from '@/engine/tipos';
import { resumenMensual } from './resumen';

/** Cuantil de la normal estándar para la excedencia del 90 % (P90). */
export const Z_P90 = 1.2815515655446004;

export function media(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN;
}

/** Desviación estándar muestral (n − 1). */
export function desviacion(v: number[]): number {
  if (v.length < 2) return 0;
  const m = media(v);
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

export interface EstadisticaExcedencia {
  n: number;
  media: number;
  desviacion: number; // interanual (muestral)
  cv: number; // desviación / media
  sigmaTotal: number; // combina variabilidad interanual e incertidumbre del dato
  p50: number;
  p90: number; // un año cualquiera
  p90Decenal: number; // promedio de 10 años
  minimo: number;
  maximo: number;
}

/**
 * P50 / P90 suponiendo distribución normal:
 *   P50 = μ
 *   P90 (1 año)   = μ − 1.2816 · √(σ² + (u·μ)²)
 *   P90 (10 años) = μ − 1.2816 · √(σ²/10 + (u·μ)²)
 * σ = desviación interanual muestral; u = incertidumbre relativa del conjunto de datos (opcional).
 */
export function excedencia(valores: number[], incertidumbreDato = 0): EstadisticaExcedencia {
  const m = media(valores);
  const s = desviacion(valores);
  const ud = incertidumbreDato * m;
  const sigmaTotal = Math.sqrt(s * s + ud * ud);
  return {
    n: valores.length,
    media: m,
    desviacion: s,
    cv: m > 0 ? s / m : 0,
    sigmaTotal,
    p50: m,
    p90: m - Z_P90 * sigmaTotal,
    p90Decenal: m - Z_P90 * Math.sqrt((s * s) / 10 + ud * ud),
    minimo: Math.min(...valores),
    maximo: Math.max(...valores),
  };
}

export interface ResumenAnio {
  anio: number;
  ghiMensual: number[]; // kWh/m²·mes
  dhiMensual: number[];
  hspMensual: number[]; // kWh/m²·día
  tMensual: number[];
  ghiAnual: number;
  hsp: number;
  tMedia: number;
  tMin: number;
  tMax: number;
}

export function resumirAnio(c: DatosClima, anio: number): ResumenAnio {
  const r = resumenMensual(c);
  return {
    anio,
    ghiMensual: r.meses.map((m) => m.ghi),
    dhiMensual: r.meses.map((m) => m.dhi),
    hspMensual: r.meses.map((m) => m.hsp),
    tMensual: r.meses.map((m) => m.tamb),
    ghiAnual: r.anual.ghi,
    hsp: r.anual.hsp,
    tMedia: r.anual.tamb,
    tMin: r.anual.tmin,
    tMax: r.anual.tmax,
  };
}

export interface AnalisisMultianual {
  anios: ResumenAnio[];
  promedioMensual: number[]; // GHI kWh/m²·mes
  desviacionMensual: number[];
  hspPromedioMensual: number[];
  ghi: EstadisticaExcedencia; // irradiación anual
  peorAnio: ResumenAnio;
  mejorAnio: ResumenAnio;
  /** Mes-año con menor HSP diaria de toda la serie (crítico para off-grid). */
  peorMes: { anio: number; mes: number; hsp: number; ghi: number };
  /** Mes calendario con menor HSP promedio entre años. */
  peorMesPromedio: { mes: number; hsp: number };
}

export function analizar(series: { anio: number; clima: DatosClima }[], incertidumbreDato = 0): AnalisisMultianual {
  if (series.length === 0) throw new Error('No hay años para analizar.');
  const anios = series.map((s) => resumirAnio(s.clima, s.anio)).sort((a, b) => a.anio - b.anio);
  const promedioMensual = Array.from({ length: 12 }, (_, m) => media(anios.map((a) => a.ghiMensual[m])));
  const desviacionMensual = Array.from({ length: 12 }, (_, m) => desviacion(anios.map((a) => a.ghiMensual[m])));
  const hspPromedioMensual = promedioMensual.map((g, m) => g / DIAS_MES[m]);
  const ghi = excedencia(anios.map((a) => a.ghiAnual), incertidumbreDato);
  const porGhi = [...anios].sort((a, b) => a.ghiAnual - b.ghiAnual);
  let peorMes = { anio: anios[0].anio, mes: 0, hsp: Infinity, ghi: 0 };
  for (const a of anios) a.hspMensual.forEach((h, m) => { if (h < peorMes.hsp) peorMes = { anio: a.anio, mes: m, hsp: h, ghi: a.ghiMensual[m] }; });
  const iMin = hspPromedioMensual.indexOf(Math.min(...hspPromedioMensual));
  return {
    anios, promedioMensual, desviacionMensual, hspPromedioMensual, ghi,
    peorAnio: porGhi[0], mejorAnio: porGhi[porGhi.length - 1], peorMes,
    peorMesPromedio: { mes: iMin, hsp: hspPromedioMensual[iMin] },
  };
}

/**
 * Promedio multianual hora a hora (misma hora local de cada año).
 * Nota: suaviza la variabilidad horaria (menos horas de cielo muy claro o muy cubierto);
 * la energía anual es muy cercana a la media de las simulaciones por año, pero los
 * indicadores de off-grid (déficit) se subestiman. Ver MODELOS.md §18.
 */
export function promedioHorario(series: DatosClima[]): DatosClima {
  if (series.length === 0) throw new Error('No hay años para promediar.');
  const n = series.length;
  const prom = (k: 'ghi' | 'dni' | 'dhi' | 'tamb' | 'viento') => {
    const out = new Array<number>(HORAS_ANIO).fill(0);
    for (const s of series) for (let i = 0; i < HORAS_ANIO; i++) out[i] += s[k][i];
    return out.map((x) => Math.round((x / n) * 10) / 10);
  };
  const b = series[0];
  const anios = series.map((s) => s.anioDatos).filter((x): x is number => x !== undefined);
  return {
    ...b,
    fuente: 'promedio',
    descripcion: `Promedio horario ${anios.length ? `${Math.min(...anios)}–${Math.max(...anios)}` : ''} (${n} años, ${b.fuente === 'nasa-power' ? 'NASA POWER' : 'PVGIS'})`,
    desfaseSolarHoras: media(series.map((s) => s.desfaseSolarHoras)),
    ghi: prom('ghi'), dni: prom('dni'), dhi: prom('dhi'), tamb: prom('tamb'), viento: prom('viento'),
    anioDatos: undefined,
    origenMeses: undefined,
  };
}

export interface FilaComparacion {
  mes: number;
  a: number;
  b: number;
  diferencia: number; // (b − a) / a
}

/** Comparación mensual de GHI entre dos fuentes (kWh/m²·mes). */
export function compararMensual(a: number[], b: number[]): { filas: FilaComparacion[]; anualA: number; anualB: number; diferenciaAnual: number } {
  const filas = a.map((x, m) => ({ mes: m, a: x, b: b[m], diferencia: x > 0 ? b[m] / x - 1 : 0 }));
  const anualA = a.reduce((s, x) => s + x, 0);
  const anualB = b.reduce((s, x) => s + x, 0);
  return { filas, anualA, anualB, diferenciaAnual: anualA > 0 ? anualB / anualA - 1 : 0 };
}

/** Redondea a 0.1 para guardar series anuales sin inflar el proyecto. */
export function redondearClima(c: DatosClima): DatosClima {
  const r = (v: number[]) => v.map((x) => Math.round(x * 10) / 10);
  return { ...c, ghi: r(c.ghi), dni: r(c.dni), dhi: r(c.dhi), tamb: r(c.tamb), viento: r(c.viento) };
}
