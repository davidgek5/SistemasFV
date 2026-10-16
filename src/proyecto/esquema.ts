/**
 * Esquema del proyecto (un único objeto JSON versionado). Se guarda en IndexedDB y se
 * exporta/importa como archivo .sfv.json. Validación con zod al importar.
 */
import { z } from 'zod';
import type {
  BancoBaterias, DatosClima, DefinicionCarga, Generador, InversorAislado, InversorRed, ModalidadRed, Regulador,
} from '@/engine/tipos';
import type { PerfilHorizonte } from '@/engine/horizonte/horizonte';
import type { CriteriosStrings } from '@/engine/dimensionamiento/strings';

export const VERSION_ESQUEMA = 1;

export type TipoSistema = 'on-grid' | 'off-grid' | 'hibrido';

export interface Proyecto {
  schemaVersion: number;
  id: string;
  nombre: string;
  cliente: string;
  notas: string;
  creado: string;
  modificado: string;
  ubicacion: { nombre: string; latitud: number; longitud: number; altitud: number; husoHorario: number };
  clima: DatosClima | null;
  horizonte: PerfilHorizonte;
  carga: DefinicionCarga;
  tipoSistema: TipoSistema;
  generador: Omit<Generador, 'horizonte'>;
  criteriosStrings: CriteriosStrings;
  onGrid: { inversor: InversorRed; nInversores: number; modalidad: ModalidadRed };
  offGrid: { banco: BancoBaterias; regulador: Regulador; nReguladores: number; inversor: InversorAislado; diasAutonomia: number };
}

const num = z.number().finite();
const serie = z.array(num).length(8760);

const climaZ = z.object({
  fuente: z.string(),
  descripcion: z.string(),
  latitud: num, longitud: num, altitud: num, husoHorario: num, desfaseSolarHoras: num, anioReferencia: z.number().int(),
  ghi: serie, dni: serie, dhi: serie, tamb: serie, viento: serie,
}).passthrough();

const equipoCargaZ = z.object({
  id: z.string(), nombre: z.string(), potencia: num.nonnegative(), cantidad: num.nonnegative(),
  horasLaborable: num.min(0).max(24), horasFinDeSemana: num.min(0).max(24), inicio: num, fin: num, factorArranque: num.min(1),
});

const cargaZ = z.union([
  z.object({ modo: z.literal('equipos'), equipos: z.array(equipoCargaZ) }),
  z.object({ modo: z.literal('mensual'), consumoMensualKWh: z.array(num.nonnegative()).min(1).max(12), perfil: z.enum(['residencial', 'comercial', 'plano']) }),
]);

const equipoZ = z.object({ id: z.string(), fabricante: z.string(), modelo: z.string() }).passthrough();

export const proyectoZ = z.object({
  schemaVersion: z.number().int(),
  id: z.string(),
  nombre: z.string(),
  cliente: z.string().default(''),
  notas: z.string().default(''),
  creado: z.string(),
  modificado: z.string(),
  ubicacion: z.object({ nombre: z.string(), latitud: num.min(-90).max(90), longitud: num.min(-180).max(180), altitud: num, husoHorario: num }),
  clima: climaZ.nullable(),
  horizonte: z.object({ origen: z.enum(['pvgis', 'usuario', 'ninguno']), puntos: z.array(z.object({ azimut: num, altura: num })) }),
  carga: cargaZ,
  tipoSistema: z.enum(['on-grid', 'off-grid', 'hibrido']),
  generador: z.object({
    modulo: equipoZ, modeloModulo: z.enum(['cec', 'pvwatts']), nSerie: z.number().int().positive(), nParalelo: z.number().int().positive(),
    inclinacion: num.min(0).max(90), azimut: num.min(-180).max(180), albedo: z.array(num.min(0).max(1)).length(12),
    termico: z.object({ montaje: z.string(), Uc: num.positive(), Uv: num.nonnegative(), absortancia: num }),
    iam: z.object({ tipo: z.string() }).passthrough(),
    bifacial: z.object({ activo: z.boolean() }).passthrough(),
    perdidas: z.record(z.string(), num),
  }).passthrough(),
  criteriosStrings: z.object({ tAmbMin: num, tCeldaVerano: num, tCeldaInvierno: num, factorIsc: num }),
  onGrid: z.object({ inversor: equipoZ, nInversores: z.number().int().positive(), modalidad: z.enum(['autoconsumo', 'balanceNeto']) }),
  offGrid: z.object({
    banco: z.object({ bateria: equipoZ, nSerie: z.number().int().positive(), nParalelo: z.number().int().positive(), socMin: num, socMax: num, socInicial: num }),
    regulador: equipoZ, nReguladores: z.number().int().positive(), inversor: equipoZ, diasAutonomia: num.positive(),
  }),
});

/** Migraciones entre versiones del esquema (por ahora solo v1). */
export function migrar(datos: unknown): unknown {
  const d = datos as { schemaVersion?: number };
  if (!d || typeof d !== 'object') throw new Error('El archivo no contiene un proyecto.');
  if (d.schemaVersion === undefined) throw new Error('Falta schemaVersion: no es un proyecto de SistemasFV.');
  if (d.schemaVersion > VERSION_ESQUEMA) throw new Error(`El proyecto es de una versión más nueva de la app (v${d.schemaVersion}).`);
  return d;
}

export function validarProyecto(datos: unknown): Proyecto {
  const r = proyectoZ.safeParse(migrar(datos));
  if (!r.success) {
    const primeros = r.error.issues.slice(0, 4).map((i) => `${i.path.join('.') || '(raíz)'}: ${i.message}`);
    throw new Error('Proyecto inválido — ' + primeros.join('; '));
  }
  return r.data as unknown as Proyecto;
}
