/**
 * Posición solar con el algoritmo SPA de NREL (Reda & Andreas, 2004).
 * Incertidumbre ±0.0003° entre los años −2000 y 6000.
 * Implementación equivalente a pvlib.spa (método "nrel_numpy").
 *
 * Convenciones de salida:
 *  - cenit aparente (con refracción) y elevación en grados.
 *  - azimutPVsyst: 0° = sur, +90° = oeste, −90° = este (convención PVsyst).
 *  - azimutNorte:  0° = norte, 90° = este (convención SPA / pvlib).
 */
import {
  B0, B1, L0, L1, L2, L3, L4, L5, NUTATION_ABCD_ARRAY, NUTATION_YTERM_ARRAY, R0, R1, R2, R3, R4,
} from './spaTablas';

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface ParametrosSitio {
  latitud: number; // grados, norte positivo
  longitud: number; // grados, este positivo
  altitud: number; // m s. n. m.
  presion?: number; // hPa (mbar); por defecto según altitud
  temperatura?: number; // °C, para la refracción
  deltaT?: number; // s, TT − UT1
  refraccionAtmosferica?: number; // grados, refracción en el horizonte
}

export interface PosicionSolar {
  cenit: number; // cenit aparente (con refracción), grados
  cenitGeometrico: number; // sin refracción
  elevacion: number; // aparente, grados
  azimutNorte: number; // 0 = N, 90 = E
  azimutPVsyst: number; // 0 = S, +90 = O, −90 = E
  ecuacionDelTiempo: number; // minutos
  distanciaTierraSol: number; // UA
}

const mod = (x: number, m: number) => ((x % m) + m) % m;

function sumaTerminos(tabla: readonly (readonly number[])[], x: number): number {
  let s = 0;
  for (let i = 0; i < tabla.length; i++) {
    const r = tabla[i];
    s += r[0] * Math.cos(r[1] + r[2] * x);
  }
  return s;
}

/** Presión barométrica estándar (hPa) a partir de la altitud (ISO 2533 simplificada). */
export function presionPorAltitud(altitud: number): number {
  return 1013.25 * Math.pow(1 - 2.25577e-5 * altitud, 5.25588);
}

/** Calcula la posición solar para un instante dado en tiempo Unix (segundos, UTC). */
export function posicionSolar(unix: number, sitio: ParametrosSitio): PosicionSolar {
  const lat = sitio.latitud;
  const lon = sitio.longitud;
  const elev = sitio.altitud;
  const presion = sitio.presion ?? presionPorAltitud(elev);
  const temp = sitio.temperatura ?? 12;
  const deltaT = sitio.deltaT ?? 69;
  const refr = sitio.refraccionAtmosferica ?? 0.5667;

  const jd = unix / 86400 + 2440587.5;
  const jde = jd + deltaT / 86400;
  const jc = (jd - 2451545) / 36525;
  const jce = (jde - 2451545) / 36525;
  const jme = jce / 10;

  // Radio vector y coordenadas heliocéntricas
  const R =
    (sumaTerminos(R0, jme) +
      sumaTerminos(R1, jme) * jme +
      sumaTerminos(R2, jme) * jme ** 2 +
      sumaTerminos(R3, jme) * jme ** 3 +
      sumaTerminos(R4, jme) * jme ** 4) /
    1e8;
  const Lrad =
    (sumaTerminos(L0, jme) +
      sumaTerminos(L1, jme) * jme +
      sumaTerminos(L2, jme) * jme ** 2 +
      sumaTerminos(L3, jme) * jme ** 3 +
      sumaTerminos(L4, jme) * jme ** 4 +
      sumaTerminos(L5, jme) * jme ** 5) /
    1e8;
  const L = mod(Lrad * DEG, 360);
  const B = ((sumaTerminos(B0, jme) + sumaTerminos(B1, jme) * jme) / 1e8) * DEG;

  const Theta = mod(L + 180, 360);
  const beta = -B;

  // Nutación
  const x0 = 297.85036 + 445267.11148 * jce - 0.0019142 * jce ** 2 + jce ** 3 / 189474;
  const x1 = 357.52772 + 35999.05034 * jce - 0.0001603 * jce ** 2 - jce ** 3 / 300000;
  const x2 = 134.96298 + 477198.867398 * jce + 0.0086972 * jce ** 2 + jce ** 3 / 56250;
  const x3 = 93.27191 + 483202.017538 * jce - 0.0036825 * jce ** 2 + jce ** 3 / 327270;
  const x4 = 125.04452 - 1934.136261 * jce + 0.0020708 * jce ** 2 + jce ** 3 / 450000;
  let sumPsi = 0;
  let sumEps = 0;
  for (let i = 0; i < NUTATION_YTERM_ARRAY.length; i++) {
    const y = NUTATION_YTERM_ARRAY[i];
    const c = NUTATION_ABCD_ARRAY[i];
    const arg = (y[0] * x0 + y[1] * x1 + y[2] * x2 + y[3] * x3 + y[4] * x4) * RAD;
    sumPsi += (c[0] + c[1] * jce) * Math.sin(arg);
    sumEps += (c[2] + c[3] * jce) * Math.cos(arg);
  }
  const dPsi = sumPsi / 36000000;
  const dEps = sumEps / 36000000;

  const U = jme / 10;
  const eps0 =
    84381.448 - 4680.93 * U - 1.55 * U ** 2 + 1999.25 * U ** 3 - 51.38 * U ** 4 - 249.67 * U ** 5 -
    39.05 * U ** 6 + 7.12 * U ** 7 + 27.87 * U ** 8 + 5.79 * U ** 9 + 2.45 * U ** 10;
  const eps = eps0 / 3600 + dEps;

  const dTau = -20.4898 / (3600 * R);
  const lamda = Theta + dPsi + dTau;

  const v0 = mod(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * jc ** 2 - jc ** 3 / 38710000, 360);
  const v = v0 + dPsi * Math.cos(eps * RAD);

  const lamR = lamda * RAD;
  const epsR = eps * RAD;
  const alpha = mod(
    Math.atan2(Math.sin(lamR) * Math.cos(epsR) - Math.tan(beta * RAD) * Math.sin(epsR), Math.cos(lamR)) * DEG,
    360,
  );
  const delta =
    Math.asin(Math.sin(beta * RAD) * Math.cos(epsR) + Math.cos(beta * RAD) * Math.sin(epsR) * Math.sin(lamR)) * DEG;

  // Ecuación del tiempo
  const M =
    280.4664567 + 360007.6982779 * jme + 0.03032028 * jme ** 2 + jme ** 3 / 49931 - jme ** 4 / 15300 -
    jme ** 5 / 2000000;
  let E = mod(M - 0.0057183 - alpha + dPsi * Math.cos(epsR), 360) * 4;
  if (E > 20) E -= 1440;
  else if (E < -20) E += 1440;

  // Coordenadas topocéntricas
  const H = mod(v + lon - alpha, 360);
  const xi = 8.794 / (3600 * R);
  const u = Math.atan(0.99664719 * Math.tan(lat * RAD));
  const x = Math.cos(u) + (elev / 6378140) * Math.cos(lat * RAD);
  const y = 0.99664719 * Math.sin(u) + (elev / 6378140) * Math.sin(lat * RAD);
  const xiR = xi * RAD;
  const HR = H * RAD;
  const dAlpha =
    Math.atan2(-x * Math.sin(xiR) * Math.sin(HR), Math.cos(delta * RAD) - x * Math.sin(xiR) * Math.cos(HR)) * DEG;
  const deltaP =
    Math.atan2(
      (Math.sin(delta * RAD) - y * Math.sin(xiR)) * Math.cos(dAlpha * RAD),
      Math.cos(delta * RAD) - x * Math.sin(xiR) * Math.cos(HR),
    ) * DEG;
  const HP = H - dAlpha;

  const latR = lat * RAD;
  const e0 =
    Math.asin(Math.sin(latR) * Math.sin(deltaP * RAD) + Math.cos(latR) * Math.cos(deltaP * RAD) * Math.cos(HP * RAD)) *
    DEG;
  const dE =
    e0 >= -1 * (0.26667 + refr)
      ? (presion / 1010) * (283 / (273 + temp)) * (1.02 / (60 * Math.tan((e0 + 10.3 / (e0 + 5.11)) * RAD)))
      : 0;
  const e = e0 + dE;

  const gamma = mod(
    Math.atan2(Math.sin(HP * RAD), Math.cos(HP * RAD) * Math.sin(latR) - Math.tan(deltaP * RAD) * Math.cos(latR)) * DEG,
    360,
  );
  const phi = mod(gamma + 180, 360);

  return {
    cenit: 90 - e,
    cenitGeometrico: 90 - e0,
    elevacion: e,
    azimutNorte: phi,
    azimutPVsyst: phi - 180,
    ecuacionDelTiempo: E,
    distanciaTierraSol: R,
  };
}
