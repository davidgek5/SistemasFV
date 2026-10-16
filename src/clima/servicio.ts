/**
 * Descarga de datos meteorológicos a través del proxy /api (Vercel), con caché local en IndexedDB.
 * Si la app está alojada sin funciones serverless, NASA POWER se intenta directamente (admite CORS);
 * PVGIS requiere el proxy.
 */
import { escribirCache, leerCache } from '@/proyecto/db';
import { leerNASAJson, leerPVGISJson } from './lectores';
import type { DatosClima } from '@/engine/tipos';
import type { PuntoHorizonte } from '@/engine/horizonte/horizonte';

const r2 = (x: number) => Math.round(x * 100) / 100;

async function obtenerJSON(clave: string, rutas: string[], forzar = false): Promise<{ texto: string; deCache: boolean }> {
  if (!forzar) {
    const c = await leerCache(clave);
    if (c) return { texto: c, deCache: true };
  }
  let ultimoError = '';
  for (const url of rutas) {
    try {
      const r = await fetch(url);
      const texto = await r.text();
      if (r.ok && texto.trimStart().startsWith('{')) {
        await escribirCache(clave, texto);
        return { texto, deCache: false };
      }
      try {
        const j = JSON.parse(texto);
        ultimoError = [j.error, typeof j.detalle === 'string' ? j.detalle : j.messages?.join?.(' ') ?? j.message].filter(Boolean).join(' — ');
      } catch {
        ultimoError = r.status === 404 ? 'el servidor no tiene el proxy /api (despliega en Vercel)' : `HTTP ${r.status}`;
      }
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(ultimoError || 'No se pudo descargar.');
}

export interface ResultadoDescarga {
  clima: DatosClima;
  avisos: string[];
  deCache: boolean;
  textoOriginal: string;
}

export async function descargarPVGIS(lat: number, lon: number, forzar = false): Promise<ResultadoDescarga> {
  const { texto, deCache } = await obtenerJSON(`pvgis-tmy:${r2(lat)}:${r2(lon)}`, [`/api/pvgis-tmy?lat=${r2(lat)}&lon=${r2(lon)}`], forzar)
    .catch((e) => { throw new Error(`PVGIS: ${e.message}`); });
  const { clima, avisos } = leerPVGISJson(JSON.parse(texto));
  return { clima, avisos, deCache, textoOriginal: texto };
}

const urlNASA = (lat: number, lon: number, anio: number) =>
  `https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude=${r2(lon)}&latitude=${r2(lat)}&start=${anio}0101&end=${anio}1231&format=JSON&time-standard=UTC`;

export async function descargarNASA(lat: number, lon: number, anio: number, forzar = false): Promise<ResultadoDescarga> {
  const { texto, deCache } = await obtenerJSON(
    `nasa-power:${anio}:${r2(lat)}:${r2(lon)}`,
    [`/api/nasa-power?lat=${r2(lat)}&lon=${r2(lon)}&anio=${anio}`, urlNASA(lat, lon, anio)],
    forzar,
  ).catch((e) => { throw new Error(`NASA POWER: ${e.message}`); });
  const { clima, avisos } = leerNASAJson(JSON.parse(texto));
  return { clima, avisos, deCache, textoOriginal: texto };
}

export interface ClimatologiaNASA {
  ghi: number[]; // kWh/m²/día por mes
  dni: number[];
  dhi: number[];
  t2m: number[];
  t2mMin: number[];
  t2mMax: number[];
  viento: number[];
}

export async function climatologiaNASA(lat: number, lon: number): Promise<ClimatologiaNASA> {
  const directa = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,T2M_MIN,T2M_MAX,WS10M&community=RE&longitude=${r2(lon)}&latitude=${r2(lat)}&format=JSON`;
  const { texto } = await obtenerJSON(`nasa-clima:${r2(lat)}:${r2(lon)}`, [`/api/nasa-power?lat=${r2(lat)}&lon=${r2(lon)}&tipo=climatologia`, directa]);
  const p = JSON.parse(texto).properties.parameter;
  const MESES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const col = (k: string) => MESES.map((m) => Number(p[k]?.[m] ?? NaN));
  return { ghi: col('ALLSKY_SFC_SW_DWN'), dni: col('ALLSKY_SFC_SW_DNI'), dhi: col('ALLSKY_SFC_SW_DIFF'), t2m: col('T2M'), t2mMin: col('T2M_MIN'), t2mMax: col('T2M_MAX'), viento: col('WS10M') };
}

export async function horizontePVGIS(lat: number, lon: number): Promise<PuntoHorizonte[]> {
  const { texto } = await obtenerJSON(`pvgis-horizonte:${r2(lat)}:${r2(lon)}`, [`/api/pvgis-horizonte?lat=${r2(lat)}&lon=${r2(lon)}`])
    .catch((e) => { throw new Error(`PVGIS: ${e.message}`); });
  const perfil = JSON.parse(texto)?.outputs?.horizon_profile;
  if (!Array.isArray(perfil)) throw new Error('Respuesta de horizonte de PVGIS no reconocida.');
  // PVGIS: A = azimut (0 = sur, 90 = oeste), H_hor = altura del horizonte
  return perfil.map((x: { A: number; H_hor: number }) => ({ azimut: Number(x.A), altura: Number(x.H_hor) })).filter((x) => x.azimut < 180);
}

/** Datos de ejemplo sintéticos (sin internet). */
export async function climaEjemplo(): Promise<DatosClima> {
  const r = await fetch('/data/ibarra-sintetico.json');
  return (await r.json()) as DatosClima;
}

/** Perfil de horizonte desde CSV/TXT del usuario: columnas azimut, altura (convención PVsyst: 0 = sur). */
export function leerHorizonteTexto(texto: string): PuntoHorizonte[] {
  const pts: PuntoHorizonte[] = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = linea.trim().split(/[;,\t ]+/).map(Number);
    if (m.length >= 2 && Number.isFinite(m[0]) && Number.isFinite(m[1])) pts.push({ azimut: m[0], altura: m[1] });
  }
  if (pts.length < 2) throw new Error('El archivo debe tener al menos dos filas «azimut, altura».');
  return pts;
}
