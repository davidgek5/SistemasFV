/**
 * Sombras por horizonte lejano (perfil de altura angular vs. azimut).
 *
 * Supuestos (iguales al tratamiento de PVsyst):
 *  - El haz directo y la circunsolar se bloquean por completo cuando la elevación
 *    solar es menor que la altura del horizonte en ese azimut.
 *  - La difusa isotrópica (y la banda de horizonte de Perez) se reduce por un factor
 *    constante: la fracción de la bóveda visible por el plano, ponderada por cos(AOI).
 *  - El albedo no se modifica.
 *
 * Convención de azimut: PVsyst (0 = S, +90 = O, −90 = E), igual que el perfil de PVGIS.
 */

import { posicionSolar, type ParametrosSitio } from '../solar/spa';

const RAD = Math.PI / 180;

export interface PuntoHorizonte {
  azimut: number; // grados, −180..180
  altura: number; // grados sobre el horizonte geométrico
}

export interface PerfilHorizonte {
  origen: 'pvgis' | 'usuario' | 'ninguno';
  puntos: PuntoHorizonte[];
}

export const SIN_HORIZONTE: PerfilHorizonte = { origen: 'ninguno', puntos: [] };

const normalizar = (a: number) => ((((a + 180) % 360) + 360) % 360) - 180;

/** Ordena, normaliza azimuts y elimina duplicados. */
export function prepararPerfil(p: PerfilHorizonte): PerfilHorizonte {
  const pts = p.puntos
    .map((x) => ({ azimut: normalizar(x.azimut), altura: Math.max(0, x.altura) }))
    .sort((a, b) => a.azimut - b.azimut)
    .filter((x, i, arr) => i === 0 || x.azimut !== arr[i - 1].azimut);
  return { origen: p.origen, puntos: pts };
}

/** Altura del horizonte en un azimut (interpolación lineal circular). Perfil ya preparado. */
export function alturaHorizonte(perfil: PerfilHorizonte, azimut: number): number {
  const pts = perfil.puntos;
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].altura;
  const a = normalizar(azimut);
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].azimut >= a) {
      const p1 = i === 0 ? { azimut: pts[pts.length - 1].azimut - 360, altura: pts[pts.length - 1].altura } : pts[i - 1];
      const p2 = pts[i];
      const t = p2.azimut === p1.azimut ? 0 : (a - p1.azimut) / (p2.azimut - p1.azimut);
      return p1.altura + t * (p2.altura - p1.altura);
    }
  }
  const p1 = pts[pts.length - 1];
  const p2 = { azimut: pts[0].azimut + 360, altura: pts[0].altura };
  const t = (a - p1.azimut) / (p2.azimut - p1.azimut);
  return p1.altura + t * (p2.altura - p1.altura);
}

/** true si el sol está detrás del horizonte lejano. */
export function solBloqueado(perfil: PerfilHorizonte, elevacionSol: number, azimutSol: number): boolean {
  if (perfil.puntos.length === 0) return false;
  return elevacionSol < alturaHorizonte(perfil, azimutSol);
}

/**
 * Factor de difusa por horizonte: fracción de la difusa isotrópica que llega al plano.
 * Integración numérica sobre la semiesfera (pasos de 1° en azimut y 0.5° en elevación).
 */
export function factorDifusaHorizonte(perfil: PerfilHorizonte, inclinacion: number, azimutPlano: number): number {
  if (perfil.puntos.length === 0) return 1;
  const b = inclinacion * RAD;
  const nx = Math.sin(b) * Math.sin(azimutPlano * RAD); // eje x: oeste
  const ny = -Math.sin(b) * Math.cos(azimutPlano * RAD); // eje y: norte (azimut 0 = sur)
  const nz = Math.cos(b);
  let visible = 0;
  let total = 0;
  const dAz = 1;
  const dEl = 0.5;
  for (let az = -180 + dAz / 2; az < 180; az += dAz) {
    const h = alturaHorizonte(perfil, az);
    const ca = Math.cos(az * RAD);
    const sa = Math.sin(az * RAD);
    for (let el = dEl / 2; el < 90; el += dEl) {
      const ce = Math.cos(el * RAD);
      // dirección del cielo: azimut PVsyst (0 = S) → componente norte = −cos(az)
      const dx = ce * sa;
      const dy = -ce * ca;
      const dz = Math.sin(el * RAD);
      const c = nx * dx + ny * dy + nz * dz;
      if (c <= 0) continue;
      const w = c * ce; // dΩ ∝ cos(el)
      total += w;
      if (el >= h) visible += w;
    }
  }
  return total > 0 ? visible / total : 1;
}

// ───────────────────────── Trayectorias solares ─────────────────────────


export interface PuntoTrayectoria {
  azimut: number; // PVsyst (0 = S)
  elevacion: number;
  horaLocal: number; // horas decimales
}

/**
 * Trayectoria del sol en un día (cada `pasoMin` minutos, solo con el sol sobre el horizonte).
 * Se devuelve en tramos: un tramo nuevo empieza cuando el azimut salta de +180 a −180 (paso por el norte).
 */
export function trayectoriaSolar(anio: number, mes: number, dia: number, sitio: ParametrosSitio, husoHorario: number, pasoMin = 10): PuntoTrayectoria[][] {
  const tramos: PuntoTrayectoria[][] = [];
  let actual: PuntoTrayectoria[] = [];
  const inicio = Date.UTC(anio, mes - 1, dia) / 1000 - husoHorario * 3600;
  for (let m = 0; m <= 24 * 60; m += pasoMin) {
    const p = posicionSolar(inicio + m * 60, sitio);
    if (p.elevacion <= 0) {
      if (actual.length) tramos.push(actual);
      actual = [];
      continue;
    }
    const previo = actual[actual.length - 1];
    if (previo && Math.abs(p.azimutPVsyst - previo.azimut) > 180) {
      tramos.push(actual);
      actual = [];
    }
    actual.push({ azimut: p.azimutPVsyst, elevacion: p.elevacion, horaLocal: m / 60 });
  }
  if (actual.length) tramos.push(actual);
  return tramos;
}

/** Solsticios y equinoccios de referencia. */
export const DIAS_REFERENCIA = [
  { nombre: '21 de junio', mes: 6, dia: 21 },
  { nombre: '20 de marzo / 23 de septiembre', mes: 3, dia: 20 },
  { nombre: '21 de diciembre', mes: 12, dia: 21 },
] as const;

/** Horas del día (sobre el horizonte geométrico) en que el sol queda detrás del horizonte lejano. */
export function horasBloqueadas(tramos: PuntoTrayectoria[][], perfil: PerfilHorizonte, pasoMin = 10): number {
  let n = 0;
  for (const t of tramos) for (const q of t) if (q.elevacion < alturaHorizonte(perfil, q.azimut)) n++;
  return (n * pasoMin) / 60;
}
