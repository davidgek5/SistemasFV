/** Construye la entrada del motor a partir del proyecto. */
import { generarCarga } from '@/engine/carga/perfil';
import type { EntradaSimulacion } from '@/engine/tipos';
import type { Proyecto } from './esquema';
import { ANIO_REFERENCIA } from '@/clima/lectores';

export function cargaDelProyecto(p: Proyecto) {
  return generarCarga(p.carga, p.clima?.anioReferencia ?? ANIO_REFERENCIA);
}

export function entradaDesdeProyecto(p: Proyecto): EntradaSimulacion {
  if (!p.clima) throw new Error('Primero descarga o carga los datos meteorológicos (módulo Ubicación).');
  if (p.tipoSistema === 'hibrido') throw new Error('El sistema híbrido llega en la Fase 2.');
  const carga = cargaDelProyecto(p).serie;
  const generador = { ...p.generador, horizonte: p.horizonte };
  const sistema = p.tipoSistema === 'on-grid'
    ? { tipo: 'on-grid' as const, ...p.onGrid }
    : { tipo: 'off-grid' as const, banco: p.offGrid.banco, regulador: p.offGrid.regulador, nReguladores: p.offGrid.nReguladores, inversor: p.offGrid.inversor };
  return { clima: p.clima, carga, generador, sistema };
}
