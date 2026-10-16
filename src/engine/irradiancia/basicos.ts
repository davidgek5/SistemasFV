/** Funciones básicas de irradiancia y geometría (grados en la interfaz pública). */

const RAD = Math.PI / 180;
const cosd = (x: number) => Math.cos(x * RAD);
const sind = (x: number) => Math.sin(x * RAD);

/** Constante solar (W/m²). pvlib usa 1366.1; PVsyst usa 1367. */
export const CONSTANTE_SOLAR = 1366.1;

/** Irradiancia extraterrestre normal (W/m²), método de Spencer (1971). */
export function irradianciaExtraterrestre(diaDelAnio: number, constante = CONSTANTE_SOLAR): number {
  const b = (2 * Math.PI * (diaDelAnio - 1)) / 365;
  const rover =
    1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b);
  return constante * rover;
}

/** Masa de aire relativa, Kasten & Young (1989). NaN si el sol está bajo el horizonte. */
export function masaDeAireRelativa(cenit: number): number {
  if (!(cenit < 90)) return NaN;
  return 1 / (cosd(cenit) + 0.50572 * Math.pow(96.07995 - cenit, -1.6364));
}

/** Masa de aire absoluta (corregida por presión, Pa). */
export function masaDeAireAbsoluta(amRelativa: number, presionPa = 101325): number {
  return (amRelativa * presionPa) / 101325;
}

/**
 * Coseno del ángulo de incidencia sobre un plano.
 * Los azimuts deben estar en la misma convención (aquí PVsyst: 0 = S, +90 = O).
 */
export function cosAOI(inclinacion: number, azimutPlano: number, cenit: number, azimutSol: number): number {
  const p = cosd(inclinacion) * cosd(cenit) + sind(inclinacion) * sind(cenit) * cosd(azimutSol - azimutPlano);
  return Math.max(-1, Math.min(1, p));
}

/** Ángulo de incidencia en grados. */
export function aoi(inclinacion: number, azimutPlano: number, cenit: number, azimutSol: number): number {
  return Math.acos(cosAOI(inclinacion, azimutPlano, cenit, azimutSol)) / RAD;
}

/** Irradiancia reflejada por el suelo en el plano (modelo isotrópico). */
export function irradianciaSuelo(ghi: number, albedo: number, inclinacion: number): number {
  return ghi * albedo * (1 - cosd(inclinacion)) * 0.5;
}

/** Difusa del cielo en el plano con el modelo isotrópico (Liu & Jordan). */
export function difusaIsotropica(dhi: number, inclinacion: number): number {
  return dhi * (1 + cosd(inclinacion)) * 0.5;
}
