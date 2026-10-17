/** Proyecto nuevo con valores por defecto (Ibarra, Ecuador). */
import { BIFACIAL_POR_DEFECTO } from '@/engine/bifacial/bifacial';
import { SIN_HORIZONTE } from '@/engine/horizonte/horizonte';
import { IAM_POR_DEFECTO } from '@/engine/irradiancia/iam';
import { TERMICO_POR_DEFECTO } from '@/engine/termico/faiman';
import { CRITERIOS_POR_DEFECTO } from '@/engine/dimensionamiento/strings';
import { PERDIDAS_POR_DEFECTO, type EquipoCarga } from '@/engine/tipos';
import { BATERIAS, INVERSORES_AISLADOS, INVERSORES_RED, MODULOS, REGULADORES } from '@/catalogo/catalogo';
import { DATOS_SIMULACION_POR_DEFECTO, VERSION_ESQUEMA, type Proyecto } from './esquema';

export const IBARRA = { nombre: 'Ibarra, Imbabura', latitud: 0.35, longitud: -78.12, altitud: 2225, husoHorario: -5 };

export const nuevoId = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

let contador = 0;
export const idEquipo = () => `e${Date.now().toString(36)}${(contador++).toString(36)}`;

/** Equipos típicos de una vivienda en la Sierra ecuatoriana (editable). */
export function equiposEjemplo(): EquipoCarga[] {
  const e = (nombre: string, potencia: number, cantidad: number, hLab: number, hFds: number, inicio: number, fin: number, factorArranque = 1): EquipoCarga => ({
    id: idEquipo(), nombre, potencia, cantidad, horasLaborable: hLab, horasFinDeSemana: hFds, inicio, fin, factorArranque,
  });
  return [
    e('Refrigeradora', 150, 1, 10, 10, 0, 24, 4),
    e('Focos LED', 9, 8, 4, 5, 18, 23),
    e('Televisor', 100, 1, 4, 6, 17, 23),
    e('Computador portátil', 60, 2, 4, 3, 8, 22),
    e('Ducha eléctrica', 4500, 1, 0.4, 0.5, 6, 8),
    e('Lavadora', 500, 1, 0, 2, 9, 13, 3),
    e('Microondas', 1200, 1, 0.2, 0.3, 12, 14),
    e('Bomba de agua 1 HP', 750, 1, 0.5, 0.5, 6, 8, 5),
    e('Router y cargadores', 25, 1, 24, 24, 0, 24),
  ];
}

export function proyectoNuevo(nombre = 'Proyecto nuevo'): Proyecto {
  const ahora = new Date().toISOString();
  const modulo = MODULOS[0];
  const inversor = INVERSORES_RED.find((i) => i.id.includes('primo-50')) ?? INVERSORES_RED[0];
  const bateria = BATERIAS.find((b) => b.id === 'pylontech-us5000') ?? BATERIAS[0];
  return {
    schemaVersion: VERSION_ESQUEMA,
    id: nuevoId(),
    nombre,
    cliente: '',
    notas: '',
    creado: ahora,
    modificado: ahora,
    ubicacion: { ...IBARRA },
    clima: null,
    seriesAnuales: [],
    datosSimulacion: { ...DATOS_SIMULACION_POR_DEFECTO, incertidumbre: { ...DATOS_SIMULACION_POR_DEFECTO.incertidumbre } },
    exclusiones: [],
    horizonte: SIN_HORIZONTE,
    carga: { modo: 'equipos', equipos: equiposEjemplo() },
    tipoSistema: 'on-grid',
    generador: {
      modulo,
      modeloModulo: 'cec',
      nSerie: 10,
      nParalelo: 1,
      inclinacion: 10,
      azimut: 0,
      albedo: new Array(12).fill(0.2),
      termico: { ...TERMICO_POR_DEFECTO },
      iam: IAM_POR_DEFECTO,
      bifacial: { ...BIFACIAL_POR_DEFECTO },
      perdidas: { ...PERDIDAS_POR_DEFECTO },
    },
    criteriosStrings: { ...CRITERIOS_POR_DEFECTO, tAmbMin: 2 },
    onGrid: { inversor, nInversores: 1, modalidad: 'balanceNeto' },
    offGrid: {
      banco: { bateria, nSerie: 1, nParalelo: 2, socMin: 0.1, socMax: 1, socInicial: 1 },
      regulador: REGULADORES.find((r) => r.id === 'victron-250-100') ?? REGULADORES[0],
      nReguladores: 1,
      inversor: INVERSORES_AISLADOS.find((i) => i.id === 'growatt-spf5000es') ?? INVERSORES_AISLADOS[0],
      diasAutonomia: 2,
    },
  };
}
