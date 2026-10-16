/**
 * Modelo de un diodo con parámetros CEC (De Soto, Klein & Beckman 2006; Dobos 2012).
 *
 *   I = IL − I0·[exp((V + I·Rs)/(n·Ns·Vth)) − 1] − (V + I·Rs)/Rsh
 *
 * Se resuelve con la parametrización explícita en el voltaje del diodo Vd (Bishop 1988):
 *   I(Vd) = IL − I0·(exp(Vd/nNsVth) − 1) − Vd/Rsh ,   V(Vd) = Vd − I·Rs
 * Equivalente a pvlib.pvsystem.calcparams_cec + pvlib.pvsystem.singlediode.
 */

const BOLTZMANN_EV = 8.617333262e-5; // eV/K

export interface ParametrosCEC {
  aRef: number; // n·Ns·Vth a condiciones de referencia (V)
  ILref: number; // A
  I0ref: number; // A
  Rs: number; // Ω
  RshRef: number; // Ω
  alphaSc: number; // A/K (coeficiente de Isc)
  adjust: number; // % ajuste del coeficiente de temperatura (CEC)
  EgRef?: number; // eV, 1.121 para Si
  dEgdT?: number; // 1/K, −0.0002677 para Si
}

export interface CincoParametros {
  IL: number;
  I0: number;
  Rs: number;
  Rsh: number;
  nNsVth: number;
}

/** Parámetros a condiciones de operación (irradiancia efectiva W/m², temperatura de celda °C). */
export function calcParamsCEC(gEf: number, tCelda: number, p: ParametrosCEC, gRef = 1000, tRef = 25): CincoParametros {
  const EgRef = p.EgRef ?? 1.121;
  const dEgdT = p.dEgdT ?? -0.0002677;
  const alpha = p.alphaSc * (1 - p.adjust / 100);
  const TrefK = tRef + 273.15;
  const TcK = tCelda + 273.15;
  const Eg = EgRef * (1 + dEgdT * (TcK - TrefK));
  const nNsVth = p.aRef * (TcK / TrefK);
  const IL = (gEf / gRef) * (p.ILref + alpha * (TcK - TrefK));
  const I0 = p.I0ref * (TcK / TrefK) ** 3 * Math.exp(EgRef / (BOLTZMANN_EV * TrefK) - Eg / (BOLTZMANN_EV * TcK));
  const Rsh = gEf > 0 ? p.RshRef * (gRef / gEf) : Infinity;
  return { IL, I0, Rs: p.Rs, Rsh, nNsVth };
}

function corrienteVd(vd: number, c: CincoParametros): number {
  return c.IL - c.I0 * Math.expm1(vd / c.nNsVth) - vd / c.Rsh;
}

/** Derivada dI/dVd. */
function dCorrienteVd(vd: number, c: CincoParametros): number {
  return (-c.I0 * Math.exp(vd / c.nNsVth)) / c.nNsVth - 1 / c.Rsh;
}

/** Voltaje del diodo en circuito abierto (I = 0), Newton. */
function vdCircuitoAbierto(c: CincoParametros): number {
  if (c.IL <= 0) return 0;
  let vd = c.nNsVth * Math.log(c.IL / c.I0 + 1);
  for (let k = 0; k < 50; k++) {
    const f = corrienteVd(vd, c);
    const step = f / dCorrienteVd(vd, c);
    vd -= step;
    if (Math.abs(step) < 1e-12 * Math.max(1, vd)) break;
  }
  return Math.max(vd, 0);
}

/** Vd tal que V(Vd) = V objetivo (Newton sobre g(Vd) = Vd − Rs·I(Vd) − V). */
function vdParaVoltaje(v: number, c: CincoParametros, vdMax: number): number {
  let vd = Math.min(v + c.Rs * c.IL, vdMax);
  for (let k = 0; k < 60; k++) {
    const g = vd - c.Rs * corrienteVd(vd, c) - v;
    const dg = 1 - c.Rs * dCorrienteVd(vd, c);
    const step = g / dg;
    vd -= step;
    if (Math.abs(step) < 1e-12 * Math.max(1, Math.abs(vd))) break;
  }
  return vd;
}

export interface PuntosIV {
  isc: number;
  voc: number;
  imp: number;
  vmp: number;
  pmp: number;
}

const INV_PHI = (Math.sqrt(5) - 1) / 2;

/** Puntos característicos de la curva I-V para un módulo. */
export function resolverUnDiodo(c: CincoParametros): PuntosIV {
  if (!(c.IL > 0)) return { isc: 0, voc: 0, imp: 0, vmp: 0, pmp: 0 };
  const vdOC = vdCircuitoAbierto(c);
  const voc = vdOC; // en I = 0, V = Vd
  // Isc: V = 0
  const vdSC = vdParaVoltaje(0, c, vdOC);
  const isc = corrienteVd(vdSC, c);
  // Máxima potencia: búsqueda de sección áurea en Vd ∈ [vdSC, vdOC]
  const P = (vd: number) => {
    const i = corrienteVd(vd, c);
    return i * (vd - i * c.Rs);
  };
  let a = vdSC;
  let b = vdOC;
  let x1 = b - INV_PHI * (b - a);
  let x2 = a + INV_PHI * (b - a);
  let f1 = P(x1);
  let f2 = P(x2);
  for (let k = 0; k < 80 && b - a > 1e-10 * vdOC; k++) {
    if (f1 < f2) {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + INV_PHI * (b - a);
      f2 = P(x2);
    } else {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - INV_PHI * (b - a);
      f1 = P(x1);
    }
  }
  const vdMP = (a + b) / 2;
  const imp = corrienteVd(vdMP, c);
  const vmp = vdMP - imp * c.Rs;
  return { isc, voc, imp, vmp, pmp: imp * vmp };
}

/** Corriente del módulo a un voltaje dado (para operación fuera del MPP, p. ej. límites MPPT). */
export function corrienteAVoltaje(v: number, c: CincoParametros): number {
  if (!(c.IL > 0)) return 0;
  const vdOC = vdCircuitoAbierto(c);
  if (v >= vdOC) return 0;
  return Math.max(0, corrienteVd(vdParaVoltaje(v, c, vdOC), c));
}

/** Modelo simplificado PVWatts: P = Pdc0 · G/1000 · [1 + γ (Tc − 25)]. γ en 1/K (p. ej. −0.0037). */
export function potenciaPVWatts(gEf: number, tCelda: number, pdc0: number, gamma: number): number {
  return Math.max(0, (pdc0 * gEf) / 1000 * (1 + gamma * (tCelda - 25)));
}

/** Energía del gap según tecnología (SAM). */
export function bandaProhibida(tecnologia: string): { EgRef: number; dEgdT: number } {
  const t = tecnologia.toLowerCase();
  if (t.includes('cdte')) return { EgRef: 1.475, dEgdT: -0.0003 };
  if (t.includes('cigs') || t.includes('cis')) return { EgRef: 1.15, dEgdT: -0.0002677 };
  if (t.includes('amorph') || t.includes('a-si')) return { EgRef: 1.7, dEgdT: -0.0002677 };
  return { EgRef: 1.121, dEgdT: -0.0002677 };
}
