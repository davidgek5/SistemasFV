/// <reference lib="webworker" />
/** Ejecuta la simulación fuera del hilo principal para que la interfaz no se congele en el celular. */
import { simular } from '@/engine/simular';
import type { EntradaSimulacion, ResultadoSimulacion } from '@/engine/tipos';

export type MensajeEntrada = { id: number; entrada: EntradaSimulacion };
export type MensajeSalida = { id: number; ok: true; resultado: ResultadoSimulacion } | { id: number; ok: false; error: string };

self.onmessage = (e: MessageEvent<MensajeEntrada>) => {
  const { id, entrada } = e.data;
  try {
    const resultado = simular(entrada);
    const transferibles = Object.values(resultado.horario).map((a) => (a as Float32Array).buffer);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: true, resultado } satisfies MensajeSalida, transferibles);
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies MensajeSalida);
  }
};
