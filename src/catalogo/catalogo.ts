/** Catálogo de equipos (semilla de la Fase 1). En la Fase 2 se suman la base CEC completa y los equipos del usuario. */
import modulosCEC from './semilla/modulosCEC.json';
import inversoresCEC from './semilla/inversoresCEC.json';
import bateriasBase from './semilla/baterias.json';
import reguladoresBase from './semilla/reguladores.json';
import aisladosBase from './semilla/inversoresAislados.json';
import type { Bateria, InversorAislado, InversorRed, Modulo, Regulador } from '@/engine/tipos';

export const MODULOS = modulosCEC as Modulo[];
export const INVERSORES_RED = inversoresCEC as InversorRed[];
export const BATERIAS = bateriasBase as Bateria[];
export const REGULADORES = reguladoresBase as Regulador[];
export const INVERSORES_AISLADOS = aisladosBase as InversorAislado[];

export function nombreEquipo(e: { fabricante: string; modelo: string }): string {
  const marca = e.fabricante.replace(/^Shenzhen /i, '').replace(/ (Co|Inc|Ltd|GmbH|International|Technologies|Technology|Green Energy|New Energy|Energy)\b.*$/i, '');
  const primera = marca.split(' ')[0].toLowerCase();
  return e.modelo.toLowerCase().startsWith(primera) ? e.modelo : `${marca} ${e.modelo}`;
}

/** Búsqueda simple por texto y rango de potencia. */
export function buscar<T extends { fabricante: string; modelo: string }>(lista: T[], texto: string, potencia?: (x: T) => number, pMin?: number, pMax?: number): T[] {
  const q = texto.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return lista.filter((x) => {
    const s = `${x.fabricante} ${x.modelo}`.toLowerCase();
    if (!q.every((t) => s.includes(t))) return false;
    if (potencia) {
      const p = potencia(x);
      if (pMin !== undefined && p < pMin) return false;
      if (pMax !== undefined && p > pMax) return false;
    }
    return true;
  });
}
