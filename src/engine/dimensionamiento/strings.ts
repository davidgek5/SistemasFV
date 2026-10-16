/**
 * Validación de strings por temperatura (criterios de PVsyst / IEC 62548).
 *
 *  - Voc(T_min) · Ns ≤ V máx. de entrada del inversor (absoluto, ficha técnica)
 *      Voc a 1000 W/m² y temperatura de celda = temperatura ambiente mínima del sitio.
 *  - Vmp(T_celda,verano) · Ns ≥ V mín. MPPT        (PVsyst: 60 °C por defecto)
 *  - Vmp(T_celda,invierno) · Ns ≤ V máx. MPPT      (PVsyst: 20 °C por defecto)
 *  - Isc(T_celda,verano) · strings por entrada ≤ I máx. de entrada (opcional factor 1.25)
 * Se calculan con el modelo de un diodo CEC (más preciso que los coeficientes lineales).
 */
import { bandaProhibida, calcParamsCEC, resolverUnDiodo } from '../modulo/unDiodo';
import type { InversorRed, Modulo } from '../tipos';

export interface CriteriosStrings {
  tAmbMin: number; // °C (mínima absoluta del sitio)
  tCeldaVerano: number; // °C
  tCeldaInvierno: number; // °C
  factorIsc: number; // 1 o 1.25
}

export const CRITERIOS_POR_DEFECTO: CriteriosStrings = { tAmbMin: 0, tCeldaVerano: 60, tCeldaInvierno: 20, factorIsc: 1 };

export interface PuntoModulo {
  voc: number;
  vmp: number;
  isc: number;
}

export function puntoModulo(m: Modulo, g: number, tCelda: number): PuntoModulo {
  const r = resolverUnDiodo(calcParamsCEC(g, tCelda, { ...m.cec, ...bandaProhibida(m.tecnologia) }));
  return { voc: r.voc, vmp: r.vmp, isc: r.isc };
}

export type Estado = 'ok' | 'aviso' | 'error';

export interface Verificacion {
  clave: string;
  descripcion: string;
  valor: number;
  limite: number | null;
  unidad: string;
  estado: Estado;
  detalle?: string;
}

export interface RangoSerie {
  nMin: number;
  nMax: number;
  nMaxVoc: number; // por Voc / V máx. entrada
  nMaxMppt: number; // por Vmp invierno / V máx. MPPT
  nMinMppt: number; // por Vmp verano / V mín. MPPT
}

export function vMaxEntrada(inv: InversorRed): { valor: number; deFicha: boolean } {
  return inv.vdcMaxEntrada ? { valor: inv.vdcMaxEntrada, deFicha: true } : { valor: inv.sandia.Vdcmax, deFicha: false };
}

export function rangoSerie(m: Modulo, inv: InversorRed, c: CriteriosStrings): RangoSerie {
  const frio = puntoModulo(m, 1000, c.tAmbMin);
  const verano = puntoModulo(m, 1000, c.tCeldaVerano);
  const invierno = puntoModulo(m, 1000, c.tCeldaInvierno);
  const vmax = vMaxEntrada(inv).valor;
  const nMaxVoc = Math.floor(vmax / frio.voc);
  const nMaxMppt = Math.floor(inv.sandia.MpptHigh / invierno.vmp);
  const nMinMppt = Math.ceil(inv.sandia.MpptLow / verano.vmp);
  return { nMin: nMinMppt, nMax: Math.min(nMaxVoc, nMaxMppt), nMaxVoc, nMaxMppt, nMinMppt };
}

export function validarStrings(
  m: Modulo, inv: InversorRed, nSerie: number, nParalelo: number, nInversores: number, c: CriteriosStrings,
): Verificacion[] {
  const frio = puntoModulo(m, 1000, c.tAmbMin);
  const verano = puntoModulo(m, 1000, c.tCeldaVerano);
  const invierno = puntoModulo(m, 1000, c.tCeldaInvierno);
  const vmax = vMaxEntrada(inv);
  const s = inv.sandia;
  const stringsPorInv = nParalelo / Math.max(1, nInversores);
  const out: Verificacion[] = [];

  const voc = frio.voc * nSerie;
  out.push({
    clave: 'vocMax', descripcion: `Voc del string a ${c.tAmbMin} °C`, valor: voc, limite: vmax.valor, unidad: 'V',
    estado: voc > vmax.valor ? 'error' : !vmax.deFicha ? 'aviso' : voc > 0.97 * vmax.valor ? 'aviso' : 'ok',
    detalle: vmax.deFicha ? 'Límite: voltaje máximo de entrada (ficha técnica).'
      : 'Límite provisional: máximo de operación CEC. Ingresa el voltaje máximo de entrada de la ficha técnica.',
  });
  const vmpV = verano.vmp * nSerie;
  out.push({
    clave: 'vmpMin', descripcion: `Vmp del string a ${c.tCeldaVerano} °C (celda)`, valor: vmpV, limite: s.MpptLow, unidad: 'V',
    estado: vmpV < s.MpptLow ? 'error' : vmpV < 1.05 * s.MpptLow ? 'aviso' : 'ok',
    detalle: 'Debe quedar por encima del voltaje mínimo MPPT en los días más calurosos.',
  });
  const vmpI = invierno.vmp * nSerie;
  out.push({
    clave: 'vmpMax', descripcion: `Vmp del string a ${c.tCeldaInvierno} °C (celda)`, valor: vmpI, limite: s.MpptHigh, unidad: 'V',
    estado: vmpI > s.MpptHigh ? 'error' : 'ok',
    detalle: 'Debe quedar por debajo del voltaje máximo MPPT con módulos fríos.',
  });
  const isc = verano.isc * stringsPorInv * c.factorIsc;
  const iMax = inv.idcMaxEntrada ?? null;
  out.push({
    clave: 'iscMax', descripcion: `Isc de entrada por inversor${c.factorIsc !== 1 ? ` × ${c.factorIsc}` : ''}`, valor: isc, limite: iMax, unidad: 'A',
    estado: iMax === null ? 'aviso' : isc > iMax ? 'error' : 'ok',
    detalle: iMax === null ? 'Ingresa la corriente máxima de entrada de la ficha técnica para verificar.' : 'Suma de todos los strings conectados al inversor.',
  });
  const ratio = (nSerie * nParalelo * m.pNom) / (s.Paco * Math.max(1, nInversores));
  out.push({
    clave: 'dcac', descripcion: 'Relación DC/AC (Pnom FV / Pnom inversor)', valor: ratio, limite: 1.3, unidad: '',
    estado: ratio > 1.5 || ratio < 0.8 ? 'error' : ratio > 1.3 || ratio < 0.9 ? 'aviso' : 'ok',
    detalle: 'Rango habitual 1.0–1.3. Valores altos aumentan el recorte (clipping).',
  });
  return out;
}
