/**
 * Modificador por ángulo de incidencia (IAM).
 *  - ASHRAE (parámetro b0; PVsyst usa 0.05 por defecto).
 *  - Físico de Fresnel + absorción (De Soto 2006; n = 1.526, K = 4 m⁻¹, L = 2 mm).
 *  - Tabla definida por el usuario (interpolación lineal, como en PVsyst).
 * Para la difusa y el albedo se integra sobre la región del cielo / suelo (Marion 2017).
 */

const RAD = Math.PI / 180;

export type ModeloIAM =
  | { tipo: 'ashrae'; b0: number }
  | { tipo: 'fresnel'; n: number; K: number; L: number }
  | { tipo: 'tabla'; angulos: number[]; valores: number[] }
  | { tipo: 'ninguno' };

export const IAM_POR_DEFECTO: ModeloIAM = { tipo: 'ashrae', b0: 0.05 };

export function iamAshrae(aoi: number, b0: number): number {
  if (!(Math.abs(aoi) < 90)) return 0;
  return Math.max(0, 1 - b0 * (1 / Math.cos(aoi * RAD) - 1));
}

export function iamFresnel(aoi: number, n = 1.526, K = 4, L = 0.002): number {
  if (!(Math.abs(aoi) < 90)) return 0;
  const n1 = 1;
  const n2 = n;
  let cos1 = Math.max(0, Math.cos(aoi * RAD));
  let sin = Math.sqrt(1 - cos1 * cos1);
  const n1c1 = n1 * cos1;
  const n2c1 = n2 * cos1;
  sin = (n1 / n2) * sin;
  const cos2 = Math.sqrt(1 - sin * sin);
  const n1c2 = n1 * cos2;
  const n2c2 = n2 * cos2;
  const rs = ((n1c1 - n2c2) / (n1c1 + n2c2)) ** 2;
  const rp = ((n1c2 - n2c1) / (n1c2 + n2c1)) ** 2;
  const r0 = ((n1 - n2) / (n1 + n2)) ** 2;
  let ts = 1 - rs;
  let tp = 1 - rp;
  let t0 = 1 - r0;
  ts *= Math.exp((-K * L) / cos2);
  tp *= Math.exp((-K * L) / cos2);
  t0 *= Math.exp(-K * L);
  const v = (ts + tp) / 2 / t0;
  return Number.isFinite(v) ? v : 0;
}

export function iamTabla(aoi: number, angulos: number[], valores: number[]): number {
  const a = Math.abs(aoi);
  if (a >= 90) return 0;
  if (a <= angulos[0]) return valores[0];
  for (let i = 1; i < angulos.length; i++) {
    if (a <= angulos[i]) {
      const t = (a - angulos[i - 1]) / (angulos[i] - angulos[i - 1]);
      return valores[i - 1] + t * (valores[i] - valores[i - 1]);
    }
  }
  return valores[valores.length - 1];
}

export function funcionIAM(m: ModeloIAM): (aoi: number) => number {
  switch (m.tipo) {
    case 'ashrae':
      return (a) => iamAshrae(a, m.b0);
    case 'fresnel':
      return (a) => iamFresnel(a, m.n, m.K, m.L);
    case 'tabla':
      return (a) => iamTabla(a, m.angulos, m.valores);
    case 'ninguno':
      return (a) => (Math.abs(a) < 90 ? 1 : 0);
  }
}

/**
 * Integración de Marion (2017) del IAM sobre una región de la semiesfera,
 * ponderada por cos(AOI). Equivalente a pvlib.iam.marion_integrate.
 */
export function integrarIAM(f: (aoi: number) => number, inclinacion: number, region: 'cielo' | 'suelo' | 'horizonte'): number {
  const num = region === 'horizonte' ? 1800 : 180;
  const ai = Math.PI / num;
  const beta = inclinacion * RAD;
  const cb = Math.cos(beta);
  const sb = Math.sin(beta);
  let numerador = 0;
  let denominador = 0;
  for (let i = 0; i < num; i++) {
    const phi1 = i * ai;
    if (region === 'cielo' && !(phi1 + ai <= Math.PI / 2)) continue;
    if (region === 'horizonte' && !(phi1 >= 89.5 * RAD && phi1 + ai <= Math.PI / 2)) continue;
    if (region === 'suelo' && !(phi1 >= Math.PI / 2)) continue;
    const phi2 = phi1 + ai;
    const phiM = phi1 + 0.5 * ai;
    const dAs = ai * (Math.cos(phi1) - Math.cos(phi2));
    const t1 = cb * Math.cos(phiM);
    const t2 = sb * Math.sin(phiM);
    for (let j = 0; j < 2 * num; j++) {
      const psiM = j * ai + 0.5 * ai;
      const c = t1 + t2 * Math.cos(psiM);
      const ang = Math.acos(Math.max(-1, Math.min(1, c)));
      if (!(ang < Math.PI / 2)) continue;
      const w = c * dAs;
      numerador += f(ang / RAD) * w;
      denominador += w;
    }
  }
  return denominador !== 0 ? numerador / denominador : 0;
}
