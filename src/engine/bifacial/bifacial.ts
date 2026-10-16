/**
 * Módulos bifaciales — interfaz preparada para la Fase 2.
 *
 * El modelo previsto es el de factores de forma 2D para filas infinitas (equivalente
 * al modelo "unlimited sheds" de PVsyst y a pvlib.bifacial.infinite_sheds):
 *   G_posterior = f(GHI, DHI, DNI, albedo, altura, pitch/GCR, inclinación)
 *   G_efectiva  = G_frontal + φ · G_posterior · (1 − sombra_estructura) · (1 − mismatch_posterior)
 *
 * En la Fase 1 la irradiancia posterior es 0 (módulo monofacial) y el motor
 * ya tiene el término de suma, de modo que activar el modelo no cambia la cadena.
 */

export interface ParametrosBifacial {
  activo: boolean;
  factorBifacialidad: number; // φ, típico 0.65–0.85
  alturaEje: number; // m sobre el suelo
  gcr: number; // relación de cobertura del suelo (ancho de fila / pitch)
  albedoSuelo: number;
  sombraEstructura: number; // fracción
  mismatchPosterior: number; // fracción
}

export const BIFACIAL_POR_DEFECTO: ParametrosBifacial = {
  activo: false,
  factorBifacialidad: 0.7,
  alturaEje: 1.5,
  gcr: 0.4,
  albedoSuelo: 0.25,
  sombraEstructura: 0.05,
  mismatchPosterior: 0.1,
};

export interface EntradaPosterior {
  ghi: number;
  dhi: number;
  dni: number;
  cenit: number;
  azimutSol: number;
  inclinacion: number;
  azimutPlano: number;
}

/** Irradiancia efectiva posterior (W/m²) ya multiplicada por φ y pérdidas. Fase 1: 0. */
export function irradianciaPosteriorEfectiva(p: ParametrosBifacial, _e: EntradaPosterior): number {
  if (!p.activo) return 0;
  return 0;
}
