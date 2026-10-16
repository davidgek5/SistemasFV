/**
 * Modelo de inversor de Sandia (King et al., 2007), parámetros de la base CEC.
 *
 *   A = Pdco·[1 + C1(Vdc − Vdco)],  B = Pso·[1 + C2(Vdc − Vdco)],  C = C0·[1 + C3(Vdc − Vdco)]
 *   Pac = [Paco/(A − B) − C·(A − B)]·(Pdc − B) + C·(Pdc − B)²
 *
 * Límites: Pac ≤ Paco (recorte / clipping). Si Pdc < Pso el inversor no arranca.
 * El consumo nocturno (Pnt) se reporta aparte y no se resta de la producción.
 */

export interface ParametrosSandia {
  Paco: number; // W AC nominal
  Pdco: number; // W DC a la que se alcanza Paco
  Vdco: number; // V DC nominal
  Pso: number; // W DC de arranque
  C0: number;
  C1: number;
  C2: number;
  C3: number;
  Pnt: number; // W consumo nocturno
  Vdcmax: number; // V DC máximo
  Idcmax: number; // A DC máximo
  MpptLow: number; // V mínimo MPPT
  MpptHigh: number; // V máximo MPPT
}

export function potenciaACSinLimites(pdc: number, vdc: number, p: ParametrosSandia): number {
  const A = p.Pdco * (1 + p.C1 * (vdc - p.Vdco));
  const B = p.Pso * (1 + p.C2 * (vdc - p.Vdco));
  const C = p.C0 * (1 + p.C3 * (vdc - p.Vdco));
  return (p.Paco / (A - B) - C * (A - B)) * (pdc - B) + C * (pdc - B) ** 2;
}

export interface SalidaInversor {
  pac: number;
  pacSinRecorte: number;
  recortado: boolean;
}

export function inversorSandia(pdc: number, vdc: number, p: ParametrosSandia): SalidaInversor {
  if (pdc < p.Pso || pdc <= 0) return { pac: 0, pacSinRecorte: 0, recortado: false };
  const bruto = Math.max(0, potenciaACSinLimites(pdc, vdc, p));
  const pac = Math.min(bruto, p.Paco);
  return { pac, pacSinRecorte: bruto, recortado: bruto > p.Paco };
}

/** Potencia DC máxima que el inversor puede procesar sin superar Paco (inversa de Sandia). */
export function pdcParaPaco(vdc: number, p: ParametrosSandia): number {
  let lo = p.Pso;
  let hi = p.Pdco * 3;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (potenciaACSinLimites(mid, vdc, p) < p.Paco) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Inversor con eficiencia constante (para equipos off-grid sin parámetros Sandia). */
export function inversorEficienciaFija(pdc: number, eficiencia: number, pacMax: number): SalidaInversor {
  const bruto = Math.max(0, pdc * eficiencia);
  return { pac: Math.min(bruto, pacMax), pacSinRecorte: bruto, recortado: bruto > pacMax };
}
