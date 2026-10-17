/** Construye la entrada del motor a partir del proyecto. */
import { generarCarga } from '@/engine/carga/perfil';
import type { DatosClima, EntradaSimulacion, FuenteSerie, SerieAnual } from '@/engine/tipos';
import type { Proyecto } from './esquema';
import { ANIO_REFERENCIA } from '@/clima/lectores';
import { promedioHorario, type MesExcluido } from '@/clima/variabilidad';

export const NOMBRE_FUENTE: Record<FuenteSerie, string> = { 'nasa-power': 'NASA POWER', 'pvgis-serie': 'PVGIS (series)' };

export function cargaDelProyecto(p: Proyecto) {
  return generarCarga(p.carga, p.clima?.anioReferencia ?? ANIO_REFERENCIA);
}

/** Años de una fuente; por defecto sin los años excluidos por el usuario. */
export function seriesDeFuente(p: Proyecto, fuente: FuenteSerie, incluirExcluidos = false): SerieAnual[] {
  const fuera = new Set(p.exclusiones.filter((e) => e.fuente === fuente && e.mes === null).map((e) => e.anio));
  return p.seriesAnuales.filter((s) => s.fuente === fuente && (incluirExcluidos || !fuera.has(s.anio))).sort((a, b) => a.anio - b.anio);
}

/** Meses excluidos de una fuente (para promedios y análisis). */
export function mesesExcluidos(p: Proyecto, fuente: FuenteSerie): MesExcluido[] {
  return p.exclusiones.filter((e) => e.fuente === fuente && e.mes !== null).map((e) => ({ anio: e.anio, mes: e.mes! }));
}

/** Fuentes que tienen al menos un año descargado. */
export function fuentesDisponibles(p: Proyecto): FuenteSerie[] {
  return (['nasa-power', 'pvgis-serie'] as FuenteSerie[]).filter((f) => p.seriesAnuales.some((s) => s.fuente === f));
}

/** Clima con el que se simula según la elección del usuario (modo «todos» → el promedio como referencia). */
export function climaParaSimular(p: Proyecto): { clima: DatosClima; etiqueta: string } {
  const d = p.datosSimulacion;
  if (d.modo === 'principal') {
    if (!p.clima) throw new Error('Primero descarga o carga los datos meteorológicos (módulo Ubicación).');
    return { clima: p.clima, etiqueta: p.clima.descripcion };
  }
  const series = seriesDeFuente(p, d.fuente);
  if (d.modo === 'anio') {
    // Un año concreto se puede simular aunque esté excluido de los promedios
    const todos = seriesDeFuente(p, d.fuente, true);
    if (todos.length === 0) throw new Error(`No hay años descargados de ${NOMBRE_FUENTE[d.fuente]}. Descárgalos en Ubicación → Datos multianuales.`);
    const s = todos.find((x) => x.anio === d.anio) ?? todos[todos.length - 1];
    return { clima: s.clima, etiqueta: `${NOMBRE_FUENTE[d.fuente]} ${s.anio}` };
  }
  if (series.length === 0) throw new Error(`No hay años válidos de ${NOMBRE_FUENTE[d.fuente]} (descárgalos o quita las exclusiones en Ubicación → Datos multianuales).`);
  const prom = promedioHorario(series.map((s) => s.clima), mesesExcluidos(p, d.fuente));
  return { clima: prom, etiqueta: prom.descripcion };
}

export function entradaConClima(p: Proyecto, clima: DatosClima): EntradaSimulacion {
  if (p.tipoSistema === 'hibrido') throw new Error('El sistema híbrido llega en la Fase 2.');
  const carga = cargaDelProyecto(p).serie;
  const generador = { ...p.generador, horizonte: p.horizonte };
  const sistema = p.tipoSistema === 'on-grid'
    ? { tipo: 'on-grid' as const, ...p.onGrid }
    : { tipo: 'off-grid' as const, banco: p.offGrid.banco, regulador: p.offGrid.regulador, nReguladores: p.offGrid.nReguladores, inversor: p.offGrid.inversor };
  return { clima, carga, generador, sistema };
}

export function entradaDesdeProyecto(p: Proyecto): EntradaSimulacion {
  return entradaConClima(p, climaParaSimular(p).clima);
}

/** true si hay datos suficientes para simular con la elección actual. */
export function puedeSimular(p: Proyecto): boolean {
  try {
    climaParaSimular(p);
    return p.tipoSistema !== 'hibrido';
  } catch {
    return false;
  }
}
