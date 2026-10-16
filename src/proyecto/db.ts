/** Persistencia local en IndexedDB (Dexie): proyectos y caché de descargas meteorológicas. */
import Dexie, { type Table } from 'dexie';
import { actualizarProyecto, type Proyecto } from './esquema';

export interface EntradaCache {
  clave: string; // p. ej. "pvgis-tmy:0.35:-78.12"
  fecha: string;
  datos: string; // respuesta original (JSON en texto)
}

class BaseDatos extends Dexie {
  proyectos!: Table<Proyecto, string>;
  cache!: Table<EntradaCache, string>;
  constructor() {
    super('sistemasfv');
    this.version(1).stores({ proyectos: 'id, nombre, modificado', cache: 'clave, fecha' });
  }
}

export const db = new BaseDatos();

export async function listarProyectos(): Promise<Proyecto[]> {
  return (await db.proyectos.orderBy('modificado').reverse().toArray()).map(actualizarProyecto);
}

export async function guardarProyecto(p: Proyecto): Promise<void> {
  await db.proyectos.put(p);
}

export async function borrarProyecto(id: string): Promise<void> {
  await db.proyectos.delete(id);
}

export async function leerCache(clave: string, maxDias = 365): Promise<string | null> {
  const e = await db.cache.get(clave);
  if (!e) return null;
  if (Date.now() - Date.parse(e.fecha) > maxDias * 86400e3) return null;
  return e.datos;
}

export async function escribirCache(clave: string, datos: string): Promise<void> {
  await db.cache.put({ clave, fecha: new Date().toISOString(), datos });
}
