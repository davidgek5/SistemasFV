/**
 * Descomposición de Erbs, Klein & Duffie (1982): GHI → DNI + DHI.
 * Se usa solo cuando un CSV trae únicamente la irradiancia global horizontal.
 * Equivalente a pvlib.irradiance.erbs (min cos z = 0.065, cenit máx. 87°).
 */
const RAD = Math.PI / 180;

export function erbs(ghi: number, cenit: number, dniExtra: number): { dni: number; dhi: number; kt: number } {
  const I0h = dniExtra * Math.max(Math.cos(cenit * RAD), 0.065);
  const kt = Math.min(Math.max(ghi / I0h, 0), 1);
  let df: number;
  if (kt <= 0.22) df = 1 - 0.09 * kt;
  else if (kt <= 0.8) df = 0.9511 - 0.1604 * kt + 4.388 * kt ** 2 - 16.638 * kt ** 3 + 12.336 * kt ** 4;
  else df = 0.165;
  let dhi = df * ghi;
  let dni = (ghi - dhi) / Math.cos(cenit * RAD);
  if (cenit > 87 || ghi < 0 || dni < 0 || !Number.isFinite(dni)) {
    dni = 0;
    dhi = ghi;
  }
  return { dni, dhi, kt };
}
