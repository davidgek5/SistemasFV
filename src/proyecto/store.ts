/** Estado global: proyecto actual (con guardado automático) y resultado de la simulación. */
import { create } from 'zustand';
import type { DatosClima, ResultadoSimulacion } from '@/engine/tipos';
import { actualizarProyecto, type Proyecto } from './esquema';
import { guardarProyecto } from './db';
import { climaParaSimular, entradaConClima, NOMBRE_FUENTE, seriesDeFuente } from './entrada';
import type { MensajeEntrada, MensajeSalida } from '@/workers/simulacion.worker';

/** Resumen de la simulación de un año real (modo «simular todos los años»). */
export interface ResumenSimAnio {
  anio: number;
  ghi: number;
  poa: number;
  eSalida: number;
  rendimiento: number;
  pr: number;
  fraccionSolar: number;
  noSuministrada: number;
  diasConDeficit: number;
  eMensual: number[];
  noSumMensual: number[];
}

interface Estado {
  proyecto: Proyecto | null;
  guardado: 'guardado' | 'pendiente' | 'error';
  resultado: ResultadoSimulacion | null;
  resultadoDe: string | null; // marca "modificado" del proyecto simulado
  etiquetaDatos: string | null; // con qué datos se simuló
  resultadosAnuales: ResumenSimAnio[] | null;
  simulando: boolean;
  progreso: string | null;
  errorSimulacion: string | null;
  abrir: (p: Proyecto) => void;
  cerrar: () => void;
  actualizar: (f: (p: Proyecto) => Proyecto) => void;
  simular: () => Promise<void>;
}

let temporizador: ReturnType<typeof setTimeout> | undefined;
let worker: Worker | null = null;
let siguienteId = 1;

function obtenerWorker(): Worker {
  if (!worker) worker = new Worker(new URL('../workers/simulacion.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function simularEnWorker(p: Proyecto, clima: DatosClima): Promise<ResultadoSimulacion> {
  const entrada = entradaConClima(p, clima);
  const id = siguienteId++;
  const w = obtenerWorker();
  return new Promise<ResultadoSimulacion>((resolve, reject) => {
    const manejar = (e: MessageEvent<MensajeSalida>) => {
      if (e.data.id !== id) return;
      w.removeEventListener('message', manejar);
      if (e.data.ok) resolve(e.data.resultado);
      else reject(new Error(e.data.error));
    };
    w.addEventListener('message', manejar);
    w.postMessage({ id, entrada } satisfies MensajeEntrada);
  });
}

export function resumirSimulacion(anio: number, r: ResultadoSimulacion): ResumenSimAnio {
  return {
    anio,
    ghi: r.anual.ghi,
    poa: r.anual.poa,
    eSalida: r.anual.eSalida,
    rendimiento: r.anual.rendimientoEspecifico,
    pr: r.anual.pr,
    fraccionSolar: r.anual.fraccionSolar,
    noSuministrada: r.anual.noSuministrada,
    diasConDeficit: r.anual.diasConDeficit,
    eMensual: r.mensual.map((m) => m.eSalida),
    noSumMensual: r.mensual.map((m) => m.noSuministrada),
  };
}

export const useProyecto = create<Estado>((set, get) => ({
  proyecto: null,
  guardado: 'guardado',
  resultado: null,
  resultadoDe: null,
  etiquetaDatos: null,
  resultadosAnuales: null,
  simulando: false,
  progreso: null,
  errorSimulacion: null,
  abrir: (p) => set({ proyecto: actualizarProyecto(p), resultado: null, resultadoDe: null, resultadosAnuales: null, errorSimulacion: null, guardado: 'guardado' }),
  cerrar: () => set({ proyecto: null, resultado: null, resultadoDe: null, resultadosAnuales: null }),
  actualizar: (f) => {
    const actual = get().proyecto;
    if (!actual) return;
    const p = { ...f(actual), modificado: new Date().toISOString() };
    set({ proyecto: p, guardado: 'pendiente' });
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      guardarProyecto(get().proyecto!).then(
        () => set({ guardado: 'guardado' }),
        () => set({ guardado: 'error' }),
      );
    }, 600);
  },
  simular: async () => {
    const p = get().proyecto;
    if (!p) return;
    set({ simulando: true, errorSimulacion: null, progreso: null });
    try {
      const { clima, etiqueta } = climaParaSimular(p);
      let anuales: ResumenSimAnio[] | null = null;
      if (p.datosSimulacion.modo === 'todos') {
        const series = seriesDeFuente(p, p.datosSimulacion.fuente);
        anuales = [];
        for (const [k, s] of series.entries()) {
          set({ progreso: `Simulando ${NOMBRE_FUENTE[s.fuente]} ${s.anio} (${k + 1}/${series.length})…` });
          anuales.push(resumirSimulacion(s.anio, await simularEnWorker(p, s.clima)));
        }
        set({ progreso: 'Simulando el año promedio…' });
      }
      const resultado = await simularEnWorker(p, clima);
      set({ resultado, resultadoDe: p.modificado, etiquetaDatos: etiqueta, resultadosAnuales: anuales, simulando: false, progreso: null });
    } catch (e) {
      set({ simulando: false, progreso: null, errorSimulacion: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** true si el proyecto cambió después de la última simulación. */
export const useResultadoDesactualizado = () =>
  useProyecto((s) => !!s.resultado && !!s.proyecto && s.resultadoDe !== s.proyecto.modificado);
