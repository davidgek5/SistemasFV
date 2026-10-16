/**
 * Dimensionamiento automático (propuesta inicial; todo se puede ajustar a mano y volver a simular).
 *
 * On-grid:  P_FV = E_objetivo / (HSP_plano · 365 · PR_supuesto)
 * Off-grid: P_FV = E_diaria / (HSP_plano,mes crítico · PR_aislado)
 *           C_banco [Wh] = E_diaria · días_autonomía / (DoD · η_descarga · η_inversor)
 * HSP_plano se estima con la transposición isotrópica mensual (rápida); la simulación horaria
 * da después el valor exacto.
 */
import { DIAS_MES } from '../calendario';
import { rangoSerie, type CriteriosStrings } from './strings';
import type { Bateria, InversorAislado, InversorRed, Modulo, Regulador } from '../tipos';

export interface PropuestaOnGrid {
  potenciaObjetivoKWp: number;
  nModulos: number;
  nSerie: number;
  nParalelo: number;
  inversor: InversorRed | null;
  nInversores: number;
  relacionDCAC: number;
  notas: string[];
}

/** HSP diaria promedio en el plano por mes (kWh/m²/día) con modelo isotrópico simple sobre totales mensuales. */
export function hspPlanoMensual(ghiMensualKWh: number[], dhiMensualKWh: number[], inclinacion: number, albedo = 0.2): number[] {
  const c = Math.cos((inclinacion * Math.PI) / 180);
  // Sin datos de directa por hora, la ganancia del haz se aproxima a 1 cerca del ecuador (inclinaciones bajas).
  return ghiMensualKWh.map((g, m) => {
    const d = dhiMensualKWh[m];
    const b = g - d;
    const poa = b * 1 + d * (1 + c) / 2 + g * albedo * (1 - c) / 2;
    return poa / DIAS_MES[m];
  });
}

export function proponerOnGrid(
  energiaAnualObjetivoKWh: number, hspPlanoAnual: number, modulo: Modulo, inversores: InversorRed[], criterios: CriteriosStrings,
  prSupuesto = 0.8, relacionObjetivo = 1.15,
): PropuestaOnGrid {
  const notas: string[] = [];
  const kWp = energiaAnualObjetivoKWh / (hspPlanoAnual * 365 * prSupuesto);
  let nMod = Math.max(1, Math.ceil((kWp * 1000) / modulo.pNom));
  // Elegir inversor: el de menor potencia que deje la relación DC/AC ≤ objetivo, con varias unidades si hace falta
  const pDC = nMod * modulo.pNom;
  const enVentana = (r: number) => r >= 0.85 && r <= 1.35;
  const candidatos = inversores
    .map((inv) => {
      const n = Math.max(1, Math.round(pDC / (relacionObjetivo * inv.sandia.Paco)));
      const ratio = pDC / (n * inv.sandia.Paco);
      const rango = rangoSerie(modulo, inv, criterios);
      return { inv, n, ratio, rango };
    })
    .filter((c) => c.rango.nMax >= c.rango.nMin && c.rango.nMax >= 1)
    // Preferencia: relación DC/AC en 0.85–1.35, luego menos inversores, luego relación más cercana al objetivo
    .sort((a, b) =>
      Number(enVentana(b.ratio)) - Number(enVentana(a.ratio)) || a.n - b.n ||
      Math.abs(a.ratio - relacionObjetivo) - Math.abs(b.ratio - relacionObjetivo));
  const elegido = candidatos[0];
  if (!elegido) {
    notas.push('Ningún inversor del catálogo admite strings válidos con este módulo.');
    return { potenciaObjetivoKWp: kWp, nModulos: nMod, nSerie: nMod, nParalelo: 1, inversor: null, nInversores: 1, relacionDCAC: 0, notas };
  }
  const { rango, n } = elegido;
  // Strings por inversor: tamaño de string dentro del rango que reparta mejor los módulos
  const porInv = Math.ceil(nMod / n);
  let mejor = { nSerie: rango.nMax, nPar: Math.ceil(porInv / rango.nMax), sobrante: Infinity };
  for (let s = rango.nMax; s >= Math.max(1, rango.nMin); s--) {
    const nPar = Math.max(1, Math.round(porInv / s));
    const sobrante = Math.abs(nPar * s - porInv);
    if (sobrante < mejor.sobrante) mejor = { nSerie: s, nPar, sobrante };
  }
  const nParTotal = mejor.nPar * n;
  nMod = mejor.nSerie * nParTotal;
  notas.push(`Rango de módulos en serie admisible: ${rango.nMin}–${rango.nMax}.`);
  if (!elegido.inv.vdcMaxEntrada) notas.push('El límite de Voc usa el máximo de operación CEC; verifica con la ficha técnica.');
  return {
    potenciaObjetivoKWp: kWp,
    nModulos: nMod,
    nSerie: mejor.nSerie,
    nParalelo: nParTotal,
    inversor: elegido.inv,
    nInversores: n,
    relacionDCAC: (nMod * modulo.pNom) / (n * elegido.inv.sandia.Paco),
    notas,
  };
}

export interface PropuestaOffGrid {
  energiaDiariaWh: number;
  potenciaFVkWp: number;
  nModulos: number;
  nSerie: number;
  nParalelo: number;
  voltajeSistema: number;
  capacidadRequeridaWh: number;
  bateria: Bateria | null;
  bateriasSerie: number;
  bateriasParalelo: number;
  regulador: Regulador | null;
  nReguladores: number;
  inversor: InversorAislado | null;
  notas: string[];
}

export function voltajeSistemaSugerido(potenciaPicoW: number): number {
  if (potenciaPicoW <= 1200) return 12;
  if (potenciaPicoW <= 3000) return 24;
  return 48;
}

export function proponerOffGrid(args: {
  energiaDiariaWh: number;
  hspPlanoMesCritico: number;
  potenciaPicoCargaW: number;
  potenciaArranqueW: number;
  diasAutonomia: number;
  modulo: Modulo;
  baterias: Bateria[];
  reguladores: Regulador[];
  inversores: InversorAislado[];
  tAmbMin: number;
  prAislado?: number;
  quimica?: Bateria['quimica'];
}): PropuestaOffGrid {
  const notas: string[] = [];
  const pr = args.prAislado ?? 0.65;
  const vSis = voltajeSistemaSugerido(args.potenciaPicoCargaW);
  const kWp = args.energiaDiariaWh / (args.hspPlanoMesCritico * pr) / 1000;

  // Inversor: potencia nominal ≥ pico simultáneo y potencia pico ≥ arranque
  const inv = args.inversores
    .filter((i) => i.voltajeBateria === vSis && i.potenciaNominalW >= args.potenciaPicoCargaW && i.potenciaPicoW >= args.potenciaArranqueW)
    .sort((a, b) => a.potenciaNominalW - b.potenciaNominalW)[0] ?? null;
  if (!inv) notas.push(`No hay inversor de ${vSis} V en el catálogo que cubra ${Math.round(args.potenciaPicoCargaW)} W (arranque ${Math.round(args.potenciaArranqueW)} W).`);
  const etaInv = inv?.eficiencia ?? 0.92;

  // Banco
  const candidatas = args.baterias.filter((b) => (args.quimica ? b.quimica === args.quimica : true) && vSis % b.voltajeNominal === 0);
  let mejorBat: { b: Bateria; s: number; p: number; wh: number; costo: number } | null = null;
  for (const b of candidatas) {
    const etaD = Math.sqrt(b.eficienciaIda);
    const req = (args.energiaDiariaWh * args.diasAutonomia) / (b.dodRecomendada * etaD * etaInv);
    const s = vSis / b.voltajeNominal;
    const p = Math.max(1, Math.ceil(req / (b.energiaKWh * 1000 * s)));
    const wh = b.energiaKWh * 1000 * s * p;
    // Preferencia: baterías del voltaje del sistema y pocas unidades (cada unidad extra penaliza 4 %),
    // y evitar más de 4 ramas en paralelo
    const costo = wh * (1 + 0.04 * (s * p - 1)) * (p > 4 ? 1.5 : 1) * (s > 1 ? 1.1 : 1);
    if (!mejorBat || costo < mejorBat.costo) mejorBat = { b, s, p, wh, costo };
  }
  const capReq = mejorBat ? (args.energiaDiariaWh * args.diasAutonomia) / (mejorBat.b.dodRecomendada * Math.sqrt(mejorBat.b.eficienciaIda) * etaInv) : 0;
  if (!mejorBat) notas.push(`No hay baterías compatibles con ${vSis} V en el catálogo.`);

  // Regulador MPPT: corriente ≥ P_FV / V_banco · 1.1; strings con Voc(T_min) < Voc máx.
  const iReq = (kWp * 1000 * 1.1) / vSis;
  const reg = args.reguladores
    .filter((r) => r.voltajesBateria.includes(vSis))
    .map((r) => ({ r, n: Math.max(1, Math.ceil(iReq / r.corrienteSalidaA)) }))
    .sort((a, b) => a.n - b.n || a.r.corrienteSalidaA - b.r.corrienteSalidaA)[0];
  let nSerie = 1;
  if (reg) {
    const vocFrio = args.modulo.Voc * (1 + ((args.modulo.betaVoc / args.modulo.Voc) * (args.tAmbMin - 25)));
    nSerie = Math.max(1, Math.floor(reg.r.vocMax / vocFrio));
    // Vmp del string debe superar el voltaje de carga del banco con margen (≈ 1.25 · V_banco)
    const vmpCaliente = args.modulo.Vmp * (1 + (args.modulo.gammaPmp / 100) * (60 - 25));
    const nMinimo = Math.ceil((vSis * 1.25) / vmpCaliente);
    if (nSerie < nMinimo) notas.push('El regulador no permite un string con voltaje suficiente para cargar el banco.');
  } else notas.push(`No hay reguladores de ${vSis} V en el catálogo.`);
  const nMod = Math.max(1, Math.ceil((kWp * 1000) / args.modulo.pNom));
  const nParalelo = Math.max(1, Math.ceil(nMod / nSerie));
  notas.push(`Voltaje del sistema sugerido: ${vSis} V (por potencia pico de ${Math.round(args.potenciaPicoCargaW)} W).`);
  return {
    energiaDiariaWh: args.energiaDiariaWh,
    potenciaFVkWp: kWp,
    nModulos: nSerie * nParalelo,
    nSerie,
    nParalelo,
    voltajeSistema: vSis,
    capacidadRequeridaWh: capReq,
    bateria: mejorBat?.b ?? null,
    bateriasSerie: mejorBat?.s ?? 0,
    bateriasParalelo: mejorBat?.p ?? 0,
    regulador: reg?.r ?? null,
    nReguladores: reg?.n ?? 1,
    inversor: inv,
    notas,
  };
}
