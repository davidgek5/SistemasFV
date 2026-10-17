/**
 * Control de calidad de series meteorológicas anuales (MODELOS.md §19).
 *  - Horas válidas: horas sin valor de relleno en el archivo original.
 *  - Fuera de rango: límites "físicamente posibles" de BSRN (Long & Dutton 2002):
 *      GHI < S₀·1.5·μ₀^1.2 + 100,  DHI < S₀·0.95·μ₀^1.2 + 50,  DNI < S₀;  −40 < T < 50 °C;  0 ≤ v < 40 m/s
 *  - Irradiancia nocturna: GHI > 10 W/m² con el sol > 2° bajo el horizonte durante TODA la hora → error de huso horario.
 *  - Meses atípicos: |z| > 2 con z = (x − μ_otros) / σ_otros, usando la media y la desviación de los
 *    OTROS años (dejando uno fuera). Con la σ de todos los años incluido el propio, un valor aislado
 *    nunca supera (n−1)/√n σ (1.79σ con 5 años), por eso se excluye el año evaluado.
 *  - Preliminar: la fuente lo declara (NASA: FLASHFlux / casi tiempo real) o el año terminó hace < 12 meses.
 */
import { posicionSolar } from '@/engine/solar/spa';
import { irradianciaExtraterrestre } from '@/engine/irradiancia/basicos';
import { MES_DE_HORA, unixHora } from '@/engine/calendario';
import { HORAS_ANIO, type DatosClima, type SerieAnual } from '@/engine/tipos';
import { media, desviacion, resumirAnio } from './variabilidad';

export interface CalidadAnio {
  anio: number;
  horasValidasPct: number; // % de horas con GHI válida en el archivo de origen
  faltantes: number; // valores de relleno (todas las variables)
  fueraDeRango: { ghi: number; dhi: number; dni: number; tamb: number; viento: number; total: number };
  nocturnas: number;
  preliminar: boolean;
  motivoPreliminar: string | null;
  estado: 'ok' | 'aviso' | 'error';
}

export interface MesAtipico {
  anio: number;
  mes: number;
  valor: number; // kWh/m²·mes
  mediaOtros: number;
  z: number;
  diferencia: number; // (valor − mediaOtros) / mediaOtros
}

const RAD = Math.PI / 180;

export function calidadAnio(c: DatosClima, anio: number, hoy = new Date()): CalidadAnio {
  const fr = { ghi: 0, dhi: 0, dni: 0, tamb: 0, viento: 0, total: 0 };
  let nocturnas = 0;
  const sitio = { latitud: c.latitud, longitud: c.longitud, altitud: c.altitud };
  for (let i = 0; i < HORAS_ANIO; i++) {
    const t = c.tamb[i];
    const v = c.viento[i];
    if (t < -40 || t > 50) fr.tamb++;
    if (v < 0 || v >= 40) fr.viento++;
    if (c.ghi[i] <= 0 && c.dni[i] <= 0 && c.dhi[i] <= 0) continue;
    const t0 = unixHora(c.anioReferencia, i, c.husoHorario, c.desfaseSolarHoras);
    const sol = posicionSolar(t0, sitio);
    const s0 = irradianciaExtraterrestre(Math.floor(i / 24) + 1);
    const mu = Math.max(0, Math.cos(sol.cenit * RAD));
    if (c.ghi[i] > 10 && esNocheTodaLaHora(c, i, sitio)) nocturnas++;
    if (c.ghi[i] > s0 * 1.5 * mu ** 1.2 + 100) fr.ghi++;
    if (c.dhi[i] > s0 * 0.95 * mu ** 1.2 + 50) fr.dhi++;
    if (c.dni[i] > s0) fr.dni++;
  }
  fr.total = fr.ghi + fr.dhi + fr.dni + fr.tamb + fr.viento;
  const q = c.calidad;
  const horas = q?.horas ?? HORAS_ANIO;
  const faltantesGhi = q?.faltantes.ghi ?? 0;
  const faltantes = q ? Object.values(q.faltantes).reduce((a, b) => a + b, 0) : 0;
  const horasValidasPct = horas > 0 ? (1 - faltantesGhi / horas) * 100 : 100;
  const finAnio = Date.UTC(anio, 11, 31);
  const reciente = c.fuente === 'nasa-power' && hoy.getTime() - finAnio < 365 * 86400e3;
  const preliminar = !!q?.preliminar || reciente;
  const motivoPreliminar = q?.preliminar
    ? `La fuente declara datos casi en tiempo real${q.fuentesDatos?.length ? ` (${q.fuentesDatos.join(', ')})` : ''}.`
    : reciente
      ? 'Año reciente: NASA POWER usa datos casi en tiempo real (FLASHFlux) hasta que se procesan los definitivos (CERES SYN1deg), con meses de retraso.'
      : null;
  const estado: CalidadAnio['estado'] = horasValidasPct < 95 || nocturnas > 50 || fr.total > 50 ? 'error'
    : horasValidasPct < 99.5 || nocturnas > 0 || fr.total > 0 || preliminar ? 'aviso' : 'ok';
  return { anio, horasValidasPct, faltantes, fueraDeRango: fr, nocturnas, preliminar, motivoPreliminar, estado };
}

/**
 * true si el sol está más de 2° bajo el horizonte durante toda la hora del dato
 * (inicio, mitad y fin del intervalo [hh:00, hh+1:00) local), para no marcar las horas del amanecer/atardecer.
 */
function esNocheTodaLaHora(c: DatosClima, i: number, sitio: { latitud: number; longitud: number; altitud: number }): boolean {
  const inicio = unixHora(c.anioReferencia, i, c.husoHorario, 0);
  return [0, 1800, 3600].every((dt) => posicionSolar(inicio + dt, sitio).elevacion < -2);
}

/** Meses con |z| > umbral respecto a los otros años (dejando uno fuera). Requiere ≥ 3 años. */
export function mesesAtipicos(series: { anio: number; clima: DatosClima }[], umbral = 2): MesAtipico[] {
  if (series.length < 3) return [];
  const res = series.map((s) => resumirAnio(s.clima, s.anio));
  const out: MesAtipico[] = [];
  for (let m = 0; m < 12; m++) {
    for (const r of res) {
      const otros = res.filter((x) => x.anio !== r.anio).map((x) => x.ghiMensual[m]);
      const mu = media(otros);
      // σ mínima del 2 % de la media para no marcar diferencias minúsculas cuando los otros años son casi iguales
      const sd = Math.max(desviacion(otros), 0.02 * mu);
      const z = sd > 0 ? (r.ghiMensual[m] - mu) / sd : 0;
      if (Math.abs(z) > umbral) out.push({ anio: r.anio, mes: m, valor: r.ghiMensual[m], mediaOtros: mu, z, diferencia: mu > 0 ? r.ghiMensual[m] / mu - 1 : 0 });
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

export function calidadSeries(series: SerieAnual[], hoy = new Date()): { anios: CalidadAnio[]; atipicos: MesAtipico[] } {
  return { anios: series.map((s) => calidadAnio(s.clima, s.anio, hoy)), atipicos: mesesAtipicos(series) };
}

/** Horas nocturnas con irradiancia por mes (diagnóstico de desfase horario). */
export function nocturnasPorMes(c: DatosClima): number[] {
  const out = new Array(12).fill(0);
  const sitio = { latitud: c.latitud, longitud: c.longitud, altitud: c.altitud };
  for (let i = 0; i < HORAS_ANIO; i++) {
    if (c.ghi[i] > 10 && esNocheTodaLaHora(c, i, sitio)) out[MES_DE_HORA[i]]++;
  }
  return out;
}
