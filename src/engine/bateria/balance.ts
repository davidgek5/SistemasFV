/**
 * Balance horario de un banco de baterías (modelo de energía).
 *
 * Supuestos:
 *  - Estado de carga (SOC) en energía: E = SOC · C_nom.
 *  - La eficiencia de ida y vuelta η_rt se reparte simétricamente: η_c = η_d = √η_rt.
 *  - Límites de SOC [socMin, socMax] y de potencia de carga/descarga (corriente máx. · V nominal).
 *  - Paso de 1 h; dentro de la hora la potencia es constante.
 *  - Ciclos equivalentes = energía descargada / capacidad útil (C_nom · (socMax − socMin)).
 *  - No se modela el voltaje, la temperatura ni el envejecimiento (ver MODELOS.md).
 */
import type { BancoBaterias } from '../tipos';

export interface EstadoBanco {
  energiaWh: number;
  capacidadWh: number;
  eMinWh: number;
  eMaxWh: number;
  etaCarga: number;
  etaDescarga: number;
  pCargaMaxW: number;
  pDescargaMaxW: number;
  descargadoWh: number; // acumulado (salida de la batería)
}

export function crearEstadoBanco(b: BancoBaterias): EstadoBanco {
  const capacidadWh = b.bateria.energiaKWh * 1000 * b.nSerie * b.nParalelo; // energía de ficha (no V·Ah nominal)
  const eta = Math.sqrt(b.bateria.eficienciaIda);
  const vBanco = b.bateria.voltajeNominal * b.nSerie;
  return {
    energiaWh: capacidadWh * b.socInicial,
    capacidadWh,
    eMinWh: capacidadWh * b.socMin,
    eMaxWh: capacidadWh * b.socMax,
    etaCarga: eta,
    etaDescarga: eta,
    pCargaMaxW: b.bateria.corrienteCargaMaxA * b.nParalelo * vBanco,
    pDescargaMaxW: b.bateria.corrienteDescargaMaxA * b.nParalelo * vBanco,
    descargadoWh: 0,
  };
}

/**
 * Carga la batería con un excedente (Wh en el bus DC durante 1 h).
 * Devuelve la energía tomada del bus (≤ excedente).
 */
export function cargar(e: EstadoBanco, excedenteWh: number): number {
  if (excedenteWh <= 0) return 0;
  const espacio = Math.max(0, e.eMaxWh - e.energiaWh) / e.etaCarga; // Wh que puede aceptar desde el bus
  const tomado = Math.min(excedenteWh, espacio, e.pCargaMaxW);
  e.energiaWh += tomado * e.etaCarga;
  return tomado;
}

/**
 * Descarga la batería para cubrir un déficit (Wh en el bus DC durante 1 h).
 * Devuelve la energía entregada al bus (≤ déficit).
 */
export function descargar(e: EstadoBanco, deficitWh: number): number {
  if (deficitWh <= 0) return 0;
  const disponible = Math.max(0, e.energiaWh - e.eMinWh) * e.etaDescarga;
  const entregado = Math.min(deficitWh, disponible, e.pDescargaMaxW);
  const extraido = entregado / e.etaDescarga;
  e.energiaWh -= extraido;
  e.descargadoWh += extraido;
  return entregado;
}

export const soc = (e: EstadoBanco) => (e.capacidadWh > 0 ? e.energiaWh / e.capacidadWh : 0);

export function ciclosEquivalentes(e: EstadoBanco): number {
  const util = e.eMaxWh - e.eMinWh;
  return util > 0 ? e.descargadoWh / util : 0;
}
