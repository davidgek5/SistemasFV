/**
 * Lectores de datos meteorológicos → DatosClima (8760 h, hora local).
 *  - PVGIS TMY (JSON de la API v5.x y CSV descargado de la web)
 *  - NASA POWER horario (JSON de la API y CSV), comunidad RE
 *  - CSV genérico (columnas reconocidas por nombre)
 * Todas las fuentes vienen en UTC; se rotan al huso local (Ecuador continental: −5).
 */
import { HORAS_ANIO, type DatosClima, type FuenteClima } from '@/engine/tipos';
import { erbs } from '@/engine/irradiancia/erbs';
import { posicionSolar } from '@/engine/solar/spa';
import { irradianciaExtraterrestre } from '@/engine/irradiancia/basicos';
import { unixHora } from '@/engine/calendario';

export const ANIO_REFERENCIA = 2025; // no bisiesto; define el calendario (días de la semana)
export const HUSO_ECUADOR = -5;

export interface SerieUTC {
  ghi: number[];
  dni: number[] | null;
  dhi: number[] | null;
  tamb: number[];
  viento: number[];
}

/** Rota una serie de 8760 h en UTC a hora local (índice 0 = 1 ene 00:00 local). */
export function rotarALocal(v: number[], huso: number): number[] {
  const n = v.length;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[i] = v[(((i - huso) % n) + n) % n];
  return out;
}

/** Quita el 29 de febrero si la serie tiene 8784 h. */
export function quitarBisiesto(v: number[]): number[] {
  if (v.length === HORAS_ANIO) return v;
  if (v.length === 8784) return [...v.slice(0, 59 * 24), ...v.slice(60 * 24)];
  throw new Error(`Se esperaban 8760 u 8784 horas y hay ${v.length}.`);
}

/**
 * Reemplaza valores faltantes (valor de relleno del archivo, −999 por defecto, o NaN):
 * irradiancia → 0, temperatura/viento → interpolación lineal.
 */
export function limpiar(v: number[], tipo: 'irradiancia' | 'continua', relleno = -999): { v: number[]; faltantes: number } {
  const faltante = (x: number) => !Number.isFinite(x) || x <= -998 || x === relleno;
  let faltantes = 0;
  const out = v.slice();
  for (let i = 0; i < out.length; i++) {
    if (!faltante(out[i])) continue;
    faltantes++;
    if (tipo === 'irradiancia') {
      out[i] = 0;
      continue;
    }
    let a = i - 1;
    while (a >= 0 && faltante(out[a])) a--;
    let b = i + 1;
    while (b < out.length && faltante(v[b])) b++;
    const va = a >= 0 ? out[a] : undefined;
    const vb = b < out.length ? v[b] : undefined;
    out[i] = va !== undefined && vb !== undefined ? va + ((vb - va) * (i - a)) / (b - a) : (va ?? vb ?? 0);
  }
  return { v: out, faltantes };
}

interface Meta {
  fuente: FuenteClima;
  descripcion: string;
  latitud: number;
  longitud: number;
  altitud: number;
  desfaseSolarHoras?: number;
  origenMeses?: { mes: number; anio: number }[];
  /** Huso de los datos de origen en horas respecto a UTC (0 = UTC; LST de NASA ≈ round(lon/15)). */
  husoOrigen?: number;
  valorRelleno?: number;
  preliminar?: boolean;
  fuentesDatos?: string[];
  mensajes?: string[];
}

/** Convierte una serie UTC a DatosClima local; si faltan DNI/DHI se obtienen con Erbs. */
export function construirClima(s: SerieUTC, meta: Meta, huso = HUSO_ECUADOR): { clima: DatosClima; avisos: string[] } {
  const avisos: string[] = [];
  const faltantes = { ghi: 0, dni: 0, dhi: 0, tamb: 0, viento: 0 };
  const rot = huso - (meta.husoOrigen ?? 0);
  const prep = (x: number[], tipo: 'irradiancia' | 'continua', nombre: string, clave: keyof typeof faltantes) => {
    const r = limpiar(quitarBisiesto(x), tipo, meta.valorRelleno);
    faltantes[clave] = r.faltantes;
    if (r.faltantes > 0) avisos.push(`${nombre}: ${r.faltantes} valores faltantes corregidos.`);
    return rotarALocal(r.v, rot);
  };
  const ghi = prep(s.ghi, 'irradiancia', 'GHI', 'ghi').map((x) => Math.max(0, x));
  const tamb = prep(s.tamb, 'continua', 'Temperatura', 'tamb');
  const viento = prep(s.viento, 'continua', 'Viento', 'viento').map((x) => Math.max(0, x));
  if (meta.preliminar) avisos.push('La fuente declara datos casi en tiempo real (provisionales) para parte del período.');
  const desfase = meta.desfaseSolarHoras ?? 0.5;
  let dni: number[];
  let dhi: number[];
  if (s.dni && s.dhi) {
    dni = prep(s.dni, 'irradiancia', 'DNI', 'dni').map((x) => Math.max(0, x));
    dhi = prep(s.dhi, 'irradiancia', 'DHI', 'dhi').map((x) => Math.max(0, x));
  } else {
    avisos.push('El archivo no trae DNI/DHI: se calcularon con el modelo de Erbs a partir de la GHI.');
    dni = new Array(HORAS_ANIO).fill(0);
    dhi = new Array(HORAS_ANIO).fill(0);
    const sitio = { latitud: meta.latitud, longitud: meta.longitud, altitud: meta.altitud };
    for (let i = 0; i < HORAS_ANIO; i++) {
      if (ghi[i] <= 0) continue;
      const p = posicionSolar(unixHora(ANIO_REFERENCIA, i, huso, desfase), sitio);
      const r = erbs(ghi[i], p.cenit, irradianciaExtraterrestre(Math.floor(i / 24) + 1));
      dni[i] = r.dni;
      dhi[i] = r.dhi;
    }
  }
  return {
    clima: {
      fuente: meta.fuente,
      descripcion: meta.descripcion,
      latitud: meta.latitud,
      longitud: meta.longitud,
      altitud: meta.altitud,
      husoHorario: huso,
      desfaseSolarHoras: desfase,
      anioReferencia: ANIO_REFERENCIA,
      ghi, dni, dhi, tamb, viento,
      origenMeses: meta.origenMeses,
      calidad: { horas: s.ghi.length, faltantes, preliminar: !!meta.preliminar, fuentesDatos: meta.fuentesDatos, mensajes: meta.mensajes },
    },
    avisos,
  };
}

// ───────────────────────── PVGIS ─────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
export function leerPVGISJson(j: any): { clima: DatosClima; avisos: string[] } {
  const filas: any[] = j?.outputs?.tmy_hourly;
  if (!Array.isArray(filas)) throw new Error('El JSON no tiene el formato TMY de PVGIS (outputs.tmy_hourly).');
  const loc = j.inputs?.location ?? {};
  const meses = (j.outputs.months_selected ?? []).map((m: any) => ({ mes: m.month, anio: m.year }));
  const col = (k: string) => filas.map((f) => Number(f[k]));
  const offset = buscarDesfasePVGIS(j);
  return construirClima(
    { ghi: col('G(h)'), dni: col('Gb(n)'), dhi: col('Gd(h)'), tamb: col('T2m'), viento: col('WS10m') },
    {
      fuente: 'pvgis-tmy',
      descripcion: `PVGIS TMY (${j.inputs?.meteo_data?.radiation_db ?? 'SARAH'}), ${meses.length ? `años ${Math.min(...meses.map((m: any) => m.anio))}–${Math.max(...meses.map((m: any) => m.anio))}` : ''}`.trim(),
      latitud: Number(loc.latitude), longitud: Number(loc.longitude), altitud: Number(loc.elevation ?? 0),
      desfaseSolarHoras: offset ?? 0.5,
      origenMeses: meses,
    },
  );
}

function buscarDesfasePVGIS(j: any): number | null {
  const texto = JSON.stringify(j?.inputs ?? {}) + JSON.stringify(j?.meta ?? {});
  const m = texto.match(/"irradiance[ _]time[ _]offset"\s*:\s*(-?[\d.]+)/i);
  return m ? Number(m[1]) : null;
}

export function leerPVGISCsv(texto: string): { clima: DatosClima; avisos: string[] } {
  const lineas = texto.split(/\r?\n/);
  const valor = (prefijo: string) => {
    const l = lineas.find((x) => x.toLowerCase().startsWith(prefijo.toLowerCase()));
    return l ? Number(l.split(':')[1]) : NaN;
  };
  const lat = valor('Latitude');
  const lon = valor('Longitude');
  const elev = valor('Elevation');
  const offset = valor('Irradiance Time Offset');
  const iCab = lineas.findIndex((l) => l.startsWith('time(UTC)'));
  if (iCab < 0) throw new Error('No se encontró la cabecera "time(UTC),T2m,…" del TMY de PVGIS.');
  const iMes = lineas.findIndex((l) => l.toLowerCase().startsWith('month,year'));
  const meses: { mes: number; anio: number }[] = [];
  if (iMes >= 0) for (let k = 1; k <= 12; k++) {
    const [mm, aa] = lineas[iMes + k].split(',').map(Number);
    meses.push({ mes: mm, anio: aa });
  }
  const cab = lineas[iCab].split(',').map((x) => x.trim());
  const filas = lineas.slice(iCab + 1, iCab + 1 + 8784).filter((l) => /^\d{8}:\d{4}/.test(l)).map((l) => l.split(','));
  const col = (k: string) => {
    const j = cab.indexOf(k);
    if (j < 0) throw new Error(`Falta la columna ${k}.`);
    return filas.map((f) => Number(f[j]));
  };
  return construirClima(
    { ghi: col('G(h)'), dni: col('Gb(n)'), dhi: col('Gd(h)'), tamb: col('T2m'), viento: col('WS10m') },
    {
      fuente: 'csv-pvgis', descripcion: 'PVGIS TMY (archivo CSV)', latitud: lat, longitud: lon, altitud: Number.isFinite(elev) ? elev : 0,
      desfaseSolarHoras: Number.isFinite(offset) ? offset : 0.5, origenMeses: meses,
    },
  );
}

// ───────────────────────── NASA POWER ─────────────────────────

export const PARAMS_NASA_HORARIO = ['ALLSKY_SFC_SW_DWN', 'ALLSKY_SFC_SW_DNI', 'ALLSKY_SFC_SW_DIFF', 'T2M', 'WS10M'];

/** Fuentes de NASA POWER que indican datos casi en tiempo real (provisionales). */
export const FUENTES_PRELIMINARES = /flash|nrt|near.?real|fp-?it|geos.?it|provisional|prelim/i;

export function leerNASAJson(j: any): { clima: DatosClima; avisos: string[] } {
  const p = j?.properties?.parameter;
  if (!p?.ALLSKY_SFC_SW_DWN) throw new Error('El JSON no tiene el formato horario de NASA POWER (properties.parameter).');
  const claves = Object.keys(p.ALLSKY_SFC_SW_DWN).sort();
  const col = (k: string) => (p[k] ? claves.map((c) => Number(p[k][c])) : null);
  const [lon, lat, elev] = j.geometry?.coordinates ?? [NaN, NaN, 0];
  const anio = claves[0]?.slice(0, 4);
  const h = j.header ?? {};
  // Referencia horaria declarada: UTC (pedida) o LST (hora solar estándar ≈ round(lon/15))
  const lst = String(h.time_standard ?? 'UTC').toUpperCase() === 'LST';
  const fuentes: string[] = Array.isArray(h.sources) ? h.sources.map(String) : [];
  const mensajes: string[] = Array.isArray(j.messages) ? j.messages.map(String) : [];
  const preliminar = fuentes.some((f) => FUENTES_PRELIMINARES.test(f)) || mensajes.some((m) => FUENTES_PRELIMINARES.test(m));
  const r = construirClima(
    { ghi: col('ALLSKY_SFC_SW_DWN')!, dni: col('ALLSKY_SFC_SW_DNI'), dhi: col('ALLSKY_SFC_SW_DIFF'), tamb: col('T2M')!, viento: col('WS10M') ?? col('WS2M')! },
    {
      fuente: 'nasa-power', descripcion: `NASA POWER horario, año ${anio}`, latitud: lat, longitud: lon, altitud: Number(elev) || 0, desfaseSolarHoras: 0.5,
      husoOrigen: lst ? Math.round(Number(lon) / 15) : 0,
      valorRelleno: Number.isFinite(Number(h.fill_value)) ? Number(h.fill_value) : -999,
      preliminar, fuentesDatos: fuentes, mensajes,
    },
  );
  if (lst) r.avisos.push(`NASA entregó los datos en hora solar estándar (LST, UTC${Math.round(Number(lon) / 15)}); se convirtieron a la hora local.`);
  r.avisos.push(...mensajes.map((m) => `NASA POWER: ${m}`));
  r.clima.anioDatos = Number(anio);
  return r;
}

export function leerNASACsv(texto: string, sitio?: { latitud: number; longitud: number; altitud: number }): { clima: DatosClima; avisos: string[] } {
  const lineas = texto.split(/\r?\n/);
  const fin = lineas.findIndex((l) => l.includes('-END HEADER-'));
  const cabecera = lineas.slice(0, Math.max(0, fin));
  const coord = cabecera.join(' ').match(/Latitude\s+(-?[\d.]+)\s+Longitude\s+(-?[\d.]+)/i);
  const elev = cabecera.join(' ').match(/Elevation[^=]*=\s*(-?[\d.]+)/i);
  const cab = lineas[fin + 1].split(',').map((x) => x.trim());
  const filas = lineas.slice(fin + 2).filter((l) => /^\d{4},/.test(l)).map((l) => l.split(','));
  const col = (k: string) => {
    const j = cab.indexOf(k);
    return j < 0 ? null : filas.map((f) => Number(f[j]));
  };
  const lat = coord ? Number(coord[1]) : sitio?.latitud ?? NaN;
  const lon = coord ? Number(coord[2]) : sitio?.longitud ?? NaN;
  if (!col('ALLSKY_SFC_SW_DWN')) throw new Error('Falta la columna ALLSKY_SFC_SW_DWN en el CSV de NASA POWER.');
  return construirClima(
    { ghi: col('ALLSKY_SFC_SW_DWN')!, dni: col('ALLSKY_SFC_SW_DNI'), dhi: col('ALLSKY_SFC_SW_DIFF'), tamb: col('T2M') ?? new Array(filas.length).fill(15), viento: col('WS10M') ?? col('WS2M') ?? new Array(filas.length).fill(1) },
    { fuente: 'csv-nasa', descripcion: `NASA POWER horario (archivo CSV)`, latitud: lat, longitud: lon, altitud: elev ? Number(elev[1]) : sitio?.altitud ?? 0, desfaseSolarHoras: 0.5 },
  );
}

/** Detecta el formato de un archivo de texto y lo lee. */
export function leerArchivoClima(nombre: string, texto: string, sitio?: { latitud: number; longitud: number; altitud: number }): { clima: DatosClima; avisos: string[] } {
  const t = texto.trimStart();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    if (j?.outputs?.tmy_hourly) return leerPVGISJson(j);
    if (j?.outputs?.hourly) return leerPVGISSerieJson(j);
    if (j?.properties?.parameter) return leerNASAJson(j);
    if (Array.isArray(j?.ghi) && j.ghi.length === HORAS_ANIO) return { clima: j as DatosClima, avisos: [] };
    throw new Error('JSON no reconocido (se esperaba PVGIS TMY, NASA POWER o un clima exportado por esta app).');
  }
  if (t.includes('-BEGIN HEADER-')) return leerNASACsv(texto, sitio);
  if (/time\(UTC\)/.test(t)) return leerPVGISCsv(texto);
  throw new Error(`Formato de «${nombre}» no reconocido. Se admiten CSV/JSON de PVGIS TMY y de NASA POWER.`);
}

/** Exporta un DatosClima a CSV (hora local). */
export function climaACsv(c: DatosClima): string {
  const filas = [
    `# ${c.descripcion}`,
    `# Latitud ${c.latitud}, Longitud ${c.longitud}, Altitud ${c.altitud} m, huso UTC${c.husoHorario >= 0 ? '+' : ''}${c.husoHorario}, desfase solar ${c.desfaseSolarHoras} h`,
    'hora_local,mes,dia,hora,GHI_Wm2,DNI_Wm2,DHI_Wm2,Tamb_C,Viento_ms',
  ];
  const inicio = Date.UTC(c.anioReferencia, 0, 1);
  for (let i = 0; i < HORAS_ANIO; i++) {
    const d = new Date(inicio + i * 3600e3);
    filas.push([i, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), c.ghi[i].toFixed(1), c.dni[i].toFixed(1), c.dhi[i].toFixed(1), c.tamb[i].toFixed(2), c.viento[i].toFixed(2)].join(','));
  }
  return filas.join('\n');
}

// ───────────────────────── PVGIS series horarias (seriescalc) ─────────────────────────

/** Años disponibles en PVGIS 5.3 (PVGIS-SARAH3). */
export const PVGIS_SERIES_ANIO_MIN = 2005;
export const PVGIS_SERIES_ANIO_MAX = 2023;

/**
 * Serie horaria real de un año (seriescalc, plano horizontal, components=1).
 * Gb(i) = directa horizontal, Gd(i) = difusa horizontal, Gr(i) = reflejada (0 en horizontal).
 * DNI = Gb / sin(H_sun). Las marcas de tiempo son "AAAAMMDD:HHMM" con MM = minuto del dato satelital,
 * que se usa como desfase para la posición solar.
 */
export function leerPVGISSerieJson(j: any): { clima: DatosClima; avisos: string[] } {
  const filas: any[] = j?.outputs?.hourly;
  if (!Array.isArray(filas) || filas.length < 8760) throw new Error('El JSON no tiene el formato de serie horaria de PVGIS (outputs.hourly).');
  const loc = j.inputs?.location ?? {};
  const t0: string = String(filas[0].time ?? '');
  const anio = Number(t0.slice(0, 4));
  const minuto = Number(t0.slice(11, 13)) || 0;
  const conComponentes = filas[0]['Gb(i)'] !== undefined;
  const ghi: number[] = [];
  const dni: number[] = [];
  const dhi: number[] = [];
  for (const f of filas) {
    if (conComponentes) {
      const gb = Number(f['Gb(i)']);
      const gd = Number(f['Gd(i)']);
      const gr = Number(f['Gr(i)'] ?? 0);
      const h = Number(f['H_sun']);
      ghi.push(gb + gd + gr);
      if (h > 2) {
        dni.push(gb / Math.sin((h * Math.PI) / 180));
        dhi.push(gd + gr);
      } else {
        // Sol muy bajo: la directa se suma a la difusa para conservar la GHI
        dni.push(0);
        dhi.push(gb + gd + gr);
      }
    } else ghi.push(Number(f['G(i)']));
  }
  const r = construirClima(
    { ghi, dni: conComponentes ? dni : null, dhi: conComponentes ? dhi : null, tamb: filas.map((f) => Number(f.T2m)), viento: filas.map((f) => Number(f.WS10m)) },
    {
      fuente: 'pvgis-serie',
      descripcion: `PVGIS serie horaria ${anio} (${j.inputs?.meteo_data?.radiation_db ?? 'SARAH3'})`,
      latitud: Number(loc.latitude), longitud: Number(loc.longitude), altitud: Number(loc.elevation ?? 0),
      desfaseSolarHoras: minuto / 60,
    },
  );
  r.clima.anioDatos = anio;
  return r;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
