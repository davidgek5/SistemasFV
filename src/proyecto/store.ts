/** Estado global: proyecto actual (con guardado automático) y resultado de la simulación. */
import { create } from 'zustand';
import type { ResultadoSimulacion } from '@/engine/tipos';
import type { Proyecto } from './esquema';
import { guardarProyecto } from './db';
import { entradaDesdeProyecto } from './entrada';
import type { MensajeEntrada, MensajeSalida } from '@/workers/simulacion.worker';

interface Estado {
  proyecto: Proyecto | null;
  guardado: 'guardado' | 'pendiente' | 'error';
  resultado: ResultadoSimulacion | null;
  resultadoDe: string | null; // marca "modificado" del proyecto simulado
  simulando: boolean;
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

export const useProyecto = create<Estado>((set, get) => ({
  proyecto: null,
  guardado: 'guardado',
  resultado: null,
  resultadoDe: null,
  simulando: false,
  errorSimulacion: null,
  abrir: (p) => set({ proyecto: p, resultado: null, resultadoDe: null, errorSimulacion: null, guardado: 'guardado' }),
  cerrar: () => set({ proyecto: null, resultado: null, resultadoDe: null }),
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
    set({ simulando: true, errorSimulacion: null });
    try {
      const entrada = entradaDesdeProyecto(p);
      const id = siguienteId++;
      const w = obtenerWorker();
      const resultado = await new Promise<ResultadoSimulacion>((resolve, reject) => {
        const manejar = (e: MessageEvent<MensajeSalida>) => {
          if (e.data.id !== id) return;
          w.removeEventListener('message', manejar);
          if (e.data.ok) resolve(e.data.resultado);
          else reject(new Error(e.data.error));
        };
        w.addEventListener('message', manejar);
        w.postMessage({ id, entrada } satisfies MensajeEntrada);
      });
      set({ resultado, resultadoDe: p.modificado, simulando: false });
    } catch (e) {
      set({ simulando: false, errorSimulacion: e instanceof Error ? e.message : String(e) });
    }
  },
}));

/** true si el proyecto cambió después de la última simulación. */
export const useResultadoDesactualizado = () =>
  useProyecto((s) => !!s.resultado && !!s.proyecto && s.resultadoDe !== s.proyecto.modificado);
