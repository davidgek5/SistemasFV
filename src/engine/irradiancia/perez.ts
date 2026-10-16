/**
 * Modelo de transposición de Perez et al. (1990), coeficientes "allsitescomposite1990".
 * Equivalente a pvlib.irradiance.perez. Devuelve las tres componentes de la difusa
 * del cielo para que el horizonte lejano pueda tratarlas por separado.
 */
import { cosAOI } from './basicos';

const RAD = Math.PI / 180;
const KAPPA = 1.041; // cenit en radianes

/** [f11, f12, f13, f21, f22, f23] para cada uno de los 8 intervalos de claridad ε. */
export const COEF_PEREZ_1990: readonly (readonly number[])[] = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
];

const LIMITES_EPS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2];

export interface DifusaPerez {
  total: number;
  isotropica: number;
  circunsolar: number;
  horizonte: number;
}

const CERO: DifusaPerez = { total: 0, isotropica: 0, circunsolar: 0, horizonte: 0 };

/**
 * @param dniExtra irradiancia extraterrestre normal (W/m²)
 * @param masaAire masa de aire relativa (Kasten-Young), NaN si sol bajo el horizonte
 */
export function perez(
  inclinacion: number,
  azimutPlano: number,
  dhi: number,
  dni: number,
  dniExtra: number,
  cenit: number,
  azimutSol: number,
  masaAire: number,
): DifusaPerez {
  if (!Number.isFinite(masaAire) || dhi <= 0) return CERO;
  const z = cenit * RAD;
  const delta = (dhi * masaAire) / dniExtra;
  const eps = ((dhi + dni) / dhi + KAPPA * z ** 3) / (1 + KAPPA * z ** 3);
  if (!Number.isFinite(eps)) return CERO;
  let bin = 0;
  while (bin < LIMITES_EPS.length && eps >= LIMITES_EPS[bin]) bin++;
  const c = COEF_PEREZ_1990[bin];
  const F1 = Math.max(c[0] + c[1] * delta + c[2] * z, 0);
  const F2 = c[3] + c[4] * delta + c[5] * z;

  const A = Math.max(cosAOI(inclinacion, azimutPlano, cenit, azimutSol), 0);
  const B = Math.max(Math.cos(z), Math.cos(85 * RAD));
  const t1 = 0.5 * (1 - F1) * (1 + Math.cos(inclinacion * RAD));
  const t2 = (F1 * A) / B;
  const t3 = F2 * Math.sin(inclinacion * RAD);
  const total = Math.max(dhi * (t1 + t2 + t3), 0);
  if (total === 0) return CERO;
  return { total, isotropica: dhi * t1, circunsolar: dhi * t2, horizonte: dhi * t3 };
}
