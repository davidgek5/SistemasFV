/**
 * Motor de simulación horaria (8760 h). Orquesta todos los modelos físicos y lleva
 * la contabilidad de pérdidas paso a paso, en el mismo orden que el diagrama de PVsyst.
 *
 *  GHI → transposición (Perez) → horizonte lejano → sombras cercanas → IAM → suciedad
 *      → irradiancia efectiva → energía nominal STC → nivel de irradiancia → temperatura
 *      → calidad → LID → mismatch → degradación → óhmica DC → energía virtual MPP
 *  on-grid:  → ventana MPPT → corriente máx. → umbral → sobrepotencia → eficiencia
 *            → óhmica AC → indisponibilidad → energía a la red / autoconsumo
 *  off-grid: → regulador → límite → no utilizada → batería → inversor → energía a la carga
 */
import { posicionSolar } from './solar/spa';
import { cosAOI, irradianciaExtraterrestre, irradianciaSuelo, masaDeAireRelativa } from './irradiancia/basicos';
import { perez } from './irradiancia/perez';
import { funcionIAM, integrarIAM } from './irradiancia/iam';
import { temperaturaCelda } from './termico/faiman';
import { factorDifusaHorizonte, prepararPerfil, solBloqueado } from './horizonte/horizonte';
import { irradianciaPosteriorEfectiva } from './bifacial/bifacial';
import { bandaProhibida, calcParamsCEC, corrienteAVoltaje, potenciaPVWatts, resolverUnDiodo, type CincoParametros } from './modulo/unDiodo';
import { inversorSandia, pdcParaPaco, potenciaACSinLimites } from './inversor/sandia';
import { ciclosEquivalentes, crearEstadoBanco, cargar, descargar, soc } from './bateria/balance';
import { DIAS_MES, MES_DE_HORA, diaDelAnio, unixHora } from './calendario';
import {
  HORAS_ANIO, type EntradaSimulacion, type Perdidas, type PasoCascada, type ResultadoSimulacion, type ResumenMensual, type SistemaOffGrid, type SistemaOnGrid,
} from './tipos';

const RAD = Math.PI / 180;

/** Acumuladores anuales de la cascada (Wh/m² para irradiación, Wh para energía). */
type Acum = Record<string, number>;

/** Resultado del generador FV para una hora (antes del inversor/regulador). */
interface HoraGenerador {
  poa: number; // global incidente en el plano (antes de horizonte/sombras/IAM)
  gEf: number; // efectiva frontal + posterior
  tCelda: number;
  pMPP: number; // W, potencia virtual del generador en el MPP (después de óhmica DC)
  vmpModulo: number;
  impModulo: number;
  vocModulo: number;
  params: CincoParametros | null;
  factorDC: number; // P_generador / (N · P_módulo) — para escalar puntos fuera del MPP
}

export function simular(entrada: EntradaSimulacion): ResultadoSimulacion {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const { clima, generador: gen, sistema } = entrada;
  const avisos: string[] = [];
  if (clima.ghi.length !== HORAS_ANIO) throw new Error(`Los datos climáticos deben tener 8760 h (tienen ${clima.ghi.length}).`);
  if (entrada.carga.length !== HORAS_ANIO) throw new Error('El perfil de carga debe tener 8760 h.');
  if (sistema.tipo === 'hibrido') throw new Error('El sistema híbrido se implementa en la Fase 2.');

  const m = gen.modulo;
  const nMod = gen.nSerie * gen.nParalelo;
  const pNomGen = nMod * m.pNom; // W
  const areaGen = nMod * m.area;
  const etaSTC = m.pNom / (1000 * m.area);
  const p = gen.perdidas;
  const cecParams = { ...m.cec, ...bandaProhibida(m.tecnologia) };
  const fIAM = funcionIAM(gen.iam);
  const iamCielo = integrarIAM(fIAM, gen.inclinacion, 'cielo');
  const iamSuelo = gen.inclinacion > 0 ? integrarIAM(fIAM, gen.inclinacion, 'suelo') : 0;
  const horizonte = prepararPerfil(gen.horizonte);
  const fDifHorizonte = factorDifusaHorizonte(horizonte, gen.inclinacion, gen.azimut);
  if (gen.bifacial.activo) avisos.push('El modelo bifacial se activa en la Fase 2: por ahora la cara posterior no aporta.');
  if (gen.modeloModulo === 'pvwatts') avisos.push('Modelo PVWatts: no se evalúan la ventana MPPT ni la corriente máxima del inversor.');

  const sitio = { latitud: clima.latitud, longitud: clima.longitud, altitud: clima.altitud, temperatura: 12 };

  const acc: Acum = {};
  const sumar = (k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);

  // ── 1. Generador FV hora a hora ──
  const horas: HoraGenerador[] = new Array(HORAS_ANIO);
  for (let i = 0; i < HORAS_ANIO; i++) {
    const ghi = Math.max(0, clima.ghi[i]);
    const dni = Math.max(0, clima.dni[i]);
    const dhi = Math.max(0, clima.dhi[i]);
    const ta = clima.tamb[i];
    sumar('ghi', ghi);
    if (ghi <= 0 && dni <= 0) {
      horas[i] = { poa: 0, gEf: 0, tCelda: ta, pMPP: 0, vmpModulo: 0, impModulo: 0, vocModulo: 0, params: null, factorDC: 0 };
      continue;
    }
    const sol = posicionSolar(unixHora(clima.anioReferencia, i, clima.husoHorario, clima.desfaseSolarHoras), sitio);
    const dia = diaDelAnio(i);
    const mes = MES_DE_HORA[i];
    const cz = Math.cos(sol.cenit * RAD);
    const ca = sol.cenit < 90 ? cosAOI(gen.inclinacion, gen.azimut, sol.cenit, sol.azimutPVsyst) : 0;
    const aoiGr = Math.acos(Math.max(-1, Math.min(1, ca))) / RAD;
    const dniEf = cz > 0 ? dni : 0;
    const directa = Math.max(0, dniEf * ca);
    const dif = perez(gen.inclinacion, gen.azimut, dhi, dniEf, irradianciaExtraterrestre(dia), sol.cenit, sol.azimutPVsyst, masaDeAireRelativa(sol.cenit));
    const suelo = irradianciaSuelo(ghi, gen.albedo[mes] ?? 0.2, gen.inclinacion);
    const poa = directa + dif.total + suelo;
    sumar('poa', poa);

    // Horizonte lejano
    const bloqueado = solBloqueado(horizonte, sol.elevacion, sol.azimutPVsyst);
    let b = bloqueado ? 0 : directa;
    let circ = bloqueado ? 0 : dif.circunsolar;
    let iso = dif.isotropica * fDifHorizonte;
    let band = dif.horizonte * fDifHorizonte;
    let gr = suelo;
    sumar('trasHorizonte', b + circ + iso + band + gr);

    // Sombras cercanas (factor)
    b *= 1 - p.sombraDirecta;
    circ *= 1 - p.sombraDirecta;
    iso *= 1 - p.sombraDifusa;
    band *= 1 - p.sombraDifusa;
    gr *= 1 - p.sombraDifusa;
    sumar('trasSombras', b + circ + iso + band + gr);

    // IAM: la directa y la circunsolar con el AOI del sol; la difusa con el IAM integrado
    const iamB = fIAM(aoiGr);
    const gIAM = (b + circ) * iamB + (iso + band) * iamCielo + gr * iamSuelo;
    sumar('trasIAM', gIAM);

    // Suciedad
    const gFrontal = gIAM * (1 - p.suciedad);
    const gPost = irradianciaPosteriorEfectiva(gen.bifacial, {
      ghi, dhi, dni: dniEf, cenit: sol.cenit, azimutSol: sol.azimutPVsyst, inclinacion: gen.inclinacion, azimutPlano: gen.azimut,
    });
    const gEf = gFrontal + gPost;
    sumar('efectiva', gEf);

    // Temperatura de celda (con la irradiancia incidente total, como PVsyst)
    const tc = temperaturaCelda(poa, ta, clima.viento[i], gen.termico, etaSTC);

    // Energía nominal y potencia del módulo
    sumar('eNominal', gEf * areaGen * etaSTC);
    let p25: number;
    let pTc: number;
    let vmp = 0;
    let imp = 0;
    let voc = 0;
    let params: CincoParametros | null = null;
    if (gen.modeloModulo === 'pvwatts') {
      p25 = potenciaPVWatts(gEf, 25, m.pNom, m.gammaPmp / 100);
      pTc = potenciaPVWatts(gEf, tc, m.pNom, m.gammaPmp / 100);
      vmp = m.Vmp;
      imp = vmp > 0 ? pTc / vmp : 0;
      voc = m.Voc;
    } else {
      p25 = resolverUnDiodo(calcParamsCEC(gEf, 25, cecParams)).pmp;
      params = calcParamsCEC(gEf, tc, cecParams);
      const r = resolverUnDiodo(params);
      pTc = r.pmp;
      vmp = r.vmp;
      imp = r.imp;
      voc = r.voc;
    }
    sumar('trasIrradiancia', p25 * nMod);
    sumar('trasTemperatura', pTc * nMod);
    let pg = pTc * nMod;
    pg *= 1 - p.calidadModulo;
    sumar('trasCalidad', pg);
    pg *= 1 - p.lid;
    sumar('trasLID', pg);
    pg *= 1 - p.mismatch;
    sumar('trasMismatch', pg);
    pg *= Math.pow(1 - p.degradacionAnual, Math.max(0, p.anioOperacion - 1));
    sumar('trasDegradacion', pg);
    // Óhmica DC: pérdida proporcional a I² → fracción = f · P / P_STC
    pg -= pNomGen > 0 ? (p.ohmicaDC * pg * pg) / pNomGen : 0;
    pg = Math.max(0, pg);
    sumar('trasOhmicaDC', pg);

    horas[i] = {
      poa, gEf, tCelda: tc, pMPP: pg, vmpModulo: vmp, impModulo: imp, vocModulo: voc, params,
      factorDC: pTc * nMod > 0 ? pg / (pTc * nMod) : 0,
    };
  }

  // ── 2. Etapa de conversión según el tipo de sistema ──
  const H = {
    poa: new Float32Array(HORAS_ANIO), gEf: new Float32Array(HORAS_ANIO), tCelda: new Float32Array(HORAS_ANIO),
    pDC: new Float32Array(HORAS_ANIO), pSalida: new Float32Array(HORAS_ANIO), carga: new Float32Array(HORAS_ANIO),
    autoconsumo: new Float32Array(HORAS_ANIO), inyeccion: new Float32Array(HORAS_ANIO), compra: new Float32Array(HORAS_ANIO),
    soc: new Float32Array(HORAS_ANIO), noSuministrada: new Float32Array(HORAS_ANIO), desperdiciada: new Float32Array(HORAS_ANIO),
  };
  for (let i = 0; i < HORAS_ANIO; i++) {
    H.poa[i] = horas[i].poa;
    H.gEf[i] = horas[i].gEf;
    H.tCelda[i] = horas[i].tCelda;
    H.carga[i] = Math.max(0, entrada.carga[i]);
  }

  let potenciaAC = 0;
  let horasRecorte = 0;
  let ciclos = 0;
  let diasDeficit = 0;
  let socProm = 0;

  if (sistema.tipo === 'on-grid') {
    const r = etapaOnGrid(sistema, gen.nSerie, gen.nParalelo, horas, H, sumar, gen.modeloModulo === 'pvwatts', avisos, p);
    potenciaAC = r.potenciaAC;
    horasRecorte = r.horasRecorte;
  } else {
    const r = etapaOffGrid(sistema, horas, H, sumar, avisos, acc);
    potenciaAC = sistema.inversor.potenciaNominalW;
    ciclos = r.ciclos;
    diasDeficit = r.diasDeficit;
    socProm = r.socPromedio;
  }

  // ── 3. Resúmenes ──
  const mensual: ResumenMensual[] = [];
  for (let mm = 0; mm < 12; mm++) {
    mensual.push({
      mes: mm, ghi: 0, poa: 0, efectiva: 0, tamb: 0, eDC: 0, eSalida: 0, carga: 0, autoconsumo: 0, inyeccion: 0, compra: 0,
      noSuministrada: 0, desperdiciada: 0, pr: 0,
    });
  }
  for (let i = 0; i < HORAS_ANIO; i++) {
    const r = mensual[MES_DE_HORA[i]];
    r.ghi += clima.ghi[i];
    r.poa += H.poa[i];
    r.efectiva += H.gEf[i];
    r.tamb += clima.tamb[i];
    r.eDC += H.pDC[i];
    r.eSalida += H.pSalida[i];
    r.carga += H.carga[i];
    r.autoconsumo += H.autoconsumo[i];
    r.inyeccion += H.inyeccion[i];
    r.compra += H.compra[i];
    r.noSuministrada += H.noSuministrada[i];
    r.desperdiciada += H.desperdiciada[i];
  }
  const kWp = pNomGen / 1000;
  for (const r of mensual) {
    r.tamb /= DIAS_MES[r.mes] * 24;
    for (const k of ['ghi', 'poa', 'efectiva', 'eDC', 'eSalida', 'carga', 'autoconsumo', 'inyeccion', 'compra', 'noSuministrada', 'desperdiciada'] as const) r[k] /= 1000;
    r.pr = r.poa > 0 && kWp > 0 ? r.eSalida / (r.poa * kWp) : 0;
  }
  const tot = (k: keyof ResumenMensual) => mensual.reduce((a, r) => a + (r[k] as number), 0);
  const eSalida = tot('eSalida');
  const poaAnual = tot('poa');
  const cargaAnual = tot('carga');
  const autoconsumo = tot('autoconsumo');

  let balanceNeto: ResultadoSimulacion['anual']['balanceNeto'];
  if (sistema.tipo === 'on-grid' && sistema.modalidad === 'balanceNeto') {
    let credito = 0;
    balanceNeto = mensual.map((r) => {
      const neto = r.compra - r.inyeccion - credito;
      credito = Math.max(0, -neto);
      return { mes: r.mes, facturadoKWh: Math.max(0, neto), creditoKWh: credito };
    });
  }

  const anual = {
    ghi: tot('ghi'),
    poa: poaAnual,
    eDC: tot('eDC'),
    eSalida,
    carga: cargaAnual,
    autoconsumo,
    inyeccion: tot('inyeccion'),
    compra: tot('compra'),
    noSuministrada: tot('noSuministrada'),
    desperdiciada: tot('desperdiciada'),
    rendimientoEspecifico: kWp > 0 ? eSalida / kWp : 0,
    pr: poaAnual > 0 && kWp > 0 ? eSalida / (poaAnual * kWp) : 0,
    fraccionSolar: cargaAnual > 0 ? (sistema.tipo === 'on-grid' ? autoconsumo : eSalida) / cargaAnual : 0,
    tasaAutoconsumo: sistema.tipo === 'on-grid' && eSalida > 0 ? autoconsumo / eSalida : 1,
    ciclosBateria: ciclos,
    diasConDeficit: diasDeficit,
    socPromedio: socProm,
    horasRecorte,
    balanceNeto,
  };

  return {
    tipo: sistema.tipo,
    potenciaPicoKWp: kWp,
    potenciaACkW: potenciaAC / 1000,
    horario: H,
    mensual,
    anual,
    cascada: construirCascada(acc, sistema.tipo),
    avisos,
    duracionMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}

// ───────────────────────── On-grid ─────────────────────────

function etapaOnGrid(
  s: SistemaOnGrid, nSerie: number, nParalelo: number, horas: HoraGenerador[], H: ResultadoSimulacion['horario'],
  sumar: (k: string, v: number) => void, simplificado: boolean, avisos: string[], perd: Perdidas,
) {
  const inv = s.inversor.sandia;
  const nInv = Math.max(1, s.nInversores);
  const stringsPorInv = nParalelo / nInv;
  const pacTotal = inv.Paco * nInv;
  // Solo se limita la corriente con el dato de ficha técnica (el Idcmax de la CEC no es el límite de entrada)
  const iMax = s.inversor.idcMaxEntrada ?? 0;
  if (!simplificado && !iMax) avisos.push('Ingresa la corriente máxima de entrada del inversor (ficha técnica) para evaluar el límite de corriente.');
  let horasVentana = 0;
  let horasCorriente = 0;
  let horasRecorte = 0;

  for (let i = 0; i < HORAS_ANIO; i++) {
    const h = horas[i];
    let pdc = h.pMPP;
    H.pDC[i] = pdc;
    let vdc = h.vmpModulo * nSerie;
    if (pdc > 0 && !simplificado && h.params) {
      // Ventana MPPT: fuera de ella el inversor opera en el límite de voltaje
      const vMin = inv.MpptLow;
      const vMax = inv.MpptHigh;
      let vOp = h.vmpModulo;
      let iOp = h.impModulo;
      if (h.vocModulo * nSerie < vMin) {
        pdc = 0;
        horasVentana++;
      } else if (vdc < vMin || vdc > vMax) {
        vOp = (vdc < vMin ? vMin : vMax) / nSerie;
        iOp = corrienteAVoltaje(vOp, h.params);
        const pMod = h.vmpModulo * h.impModulo;
        pdc = pMod > 0 ? (pdc * (vOp * iOp)) / pMod : 0;
        vdc = vOp * nSerie;
        horasVentana++;
      }
      sumar('trasVentanaMPPT', pdc);
      // Corriente máxima de entrada: el punto de operación se desplaza hacia voltajes mayores
      const iEntrada = iOp * stringsPorInv * h.factorDC;
      if (pdc > 0 && iMax > 0 && iEntrada > iMax) {
        const iLim = iMax / (stringsPorInv * h.factorDC);
        let lo = vOp;
        let hi = h.vocModulo;
        for (let k = 0; k < 50; k++) {
          const mid = (lo + hi) / 2;
          if (corrienteAVoltaje(mid, h.params) > iLim) lo = mid;
          else hi = mid;
        }
        const vNuevo = (lo + hi) / 2;
        const pAntes = vOp * iOp;
        const pDesp = vNuevo * corrienteAVoltaje(vNuevo, h.params);
        pdc = pAntes > 0 ? (pdc * pDesp) / pAntes : 0;
        vdc = vNuevo * nSerie;
        horasCorriente++;
      }
      sumar('trasCorrienteMax', pdc);
    } else {
      if (simplificado) vdc = inv.Vdco;
      sumar('trasVentanaMPPT', pdc);
      sumar('trasCorrienteMax', pdc);
    }

    // Inversores: cada uno recibe la misma fracción de la potencia DC
    const pdcInv = pdc / nInv;
    let pac = 0;
    if (pdcInv > 0 && pdcInv >= inv.Pso) {
      sumar('trasUmbral', pdc);
      const bruto = potenciaACSinLimites(pdcInv, vdc, inv);
      if (bruto > inv.Paco) {
        sumar('trasSobrepotencia', pdcParaPaco(vdc, inv) * nInv);
        pac = inv.Paco * nInv;
        horasRecorte++;
      } else {
        sumar('trasSobrepotencia', pdc);
        pac = inversorSandia(pdcInv, vdc, inv).pac * nInv;
      }
    }
    sumar('trasEficienciaInv', pac);

    // Óhmica AC (∝ I²) e indisponibilidad (factor uniforme)
    pac -= pacTotal > 0 ? (perd.ohmicaAC * pac * pac) / pacTotal : 0;
    pac = Math.max(0, pac);
    sumar('trasOhmicaAC', pac);
    pac *= 1 - perd.indisponibilidad;
    sumar('eRed', pac);
    H.pSalida[i] = pac;

    // Reparto con la carga
    const auto = Math.min(pac, H.carga[i]);
    H.autoconsumo[i] = auto;
    H.inyeccion[i] = pac - auto;
    H.compra[i] = H.carga[i] - auto;
  }
  if (horasVentana > 0) avisos.push(`El voltaje del string quedó fuera de la ventana MPPT durante ${horasVentana} h.`);
  if (horasCorriente > 0) avisos.push(`La corriente de entrada superó el máximo del inversor durante ${horasCorriente} h.`);
  return { potenciaAC: pacTotal, horasRecorte };
}

// ───────────────────────── Off-grid ─────────────────────────

function etapaOffGrid(
  s: SistemaOffGrid, horas: HoraGenerador[], H: ResultadoSimulacion['horario'], sumar: (k: string, v: number) => void, avisos: string[], acc: Acum,
) {
  const banco = crearEstadoBanco(s.banco);
  const e0 = banco.energiaWh;
  const vBanco = s.banco.bateria.voltajeNominal * s.banco.nSerie;
  if (s.regulador.voltajesBateria.length && !s.regulador.voltajesBateria.includes(vBanco)) {
    avisos.push(`El regulador ${s.regulador.modelo} no admite un banco de ${vBanco} V.`);
  }
  if (s.inversor.voltajeBateria !== vBanco) avisos.push(`El inversor ${s.inversor.modelo} es de ${s.inversor.voltajeBateria} V y el banco es de ${vBanco} V.`);
  const pRegMax = s.regulador.corrienteSalidaA * vBanco * Math.max(1, s.nReguladores);
  const etaInv = s.inversor.eficiencia;
  const pInvMax = s.inversor.potenciaNominalW;
  let horasSobrecarga = 0;
  let tomadoTotal = 0;
  let entregadoTotal = 0;
  let socSuma = 0;
  const deficitDia = new Uint8Array(365);

  for (let i = 0; i < HORAS_ANIO; i++) {
    const pg = horas[i].pMPP;
    H.pDC[i] = pg;
    let pReg = pg * s.regulador.eficiencia;
    sumar('trasRegulador', pReg);
    if (pReg > pRegMax) pReg = pRegMax;
    sumar('trasLimiteRegulador', pReg);

    const carga = H.carga[i];
    let cargaServible = carga;
    if (carga > pInvMax) {
      cargaServible = pInvMax;
      horasSobrecarga++;
    }
    const necesidadDC = cargaServible > 0 ? cargaServible / etaInv + s.inversor.consumoVacioW : s.inversor.consumoVacioW;
    const directo = Math.min(pReg, necesidadDC);
    let excedente = pReg - directo;
    let deficit = necesidadDC - directo;
    const tomado = cargar(banco, excedente);
    excedente -= tomado;
    tomadoTotal += tomado;
    const entregado = descargar(banco, deficit);
    deficit -= entregado;
    entregadoTotal += entregado;

    // Energía no suministrada (en AC): déficit DC remanente convertido + exceso sobre la potencia del inversor
    const servidoDC = necesidadDC - deficit;
    const servidoAC = Math.max(0, Math.min(cargaServible, (servidoDC - s.inversor.consumoVacioW) * etaInv));
    const noSum = carga - servidoAC;
    H.pSalida[i] = servidoAC;
    H.autoconsumo[i] = servidoAC;
    H.noSuministrada[i] = noSum > 1e-6 ? noSum : 0;
    H.desperdiciada[i] = excedente;
    H.soc[i] = soc(banco);
    socSuma += H.soc[i];
    if (H.noSuministrada[i] > 0) deficitDia[Math.floor(i / 24)] = 1;
  }
  const usada = (acc.trasLimiteRegulador ?? 0) - H.desperdiciada.reduce((a, b) => a + b, 0);
  sumar('fvUtilizada', usada);
  const deltaE = banco.energiaWh - e0;
  const perdidaBateria = tomadoTotal - entregadoTotal - deltaE;
  sumar('trasBateria', usada - perdidaBateria);
  sumar('trasAlmacenada', usada - perdidaBateria - deltaE);
  sumar('aCarga', H.pSalida.reduce((a, b) => a + b, 0));
  if (horasSobrecarga > 0) avisos.push(`La carga superó la potencia nominal del inversor (${pInvMax} W) durante ${horasSobrecarga} h.`);
  return {
    ciclos: ciclosEquivalentes(banco),
    diasDeficit: deficitDia.reduce((a, b) => a + b, 0),
    socPromedio: socSuma / HORAS_ANIO,
  };
}

// ───────────────────────── Cascada ─────────────────────────

function construirCascada(acc: Acum, tipo: string): PasoCascada[] {
  const irr: [string, string][] = [
    ['ghi', 'Irradiación global horizontal'],
    ['poa', 'Global incidente en el plano'],
    ['trasHorizonte', 'Horizonte lejano'],
    ['trasSombras', 'Sombras cercanas'],
    ['trasIAM', 'Factor IAM'],
    ['efectiva', 'Suciedad → irradiación efectiva'],
  ];
  const comunes: [string, string][] = [
    ['eNominal', 'Energía nominal del generador (eficiencia STC)'],
    ['trasIrradiancia', 'Nivel de irradiancia'],
    ['trasTemperatura', 'Temperatura'],
    ['trasCalidad', 'Calidad del módulo'],
    ['trasLID', 'LID (degradación inducida por la luz)'],
    ['trasMismatch', 'Mismatch'],
    ['trasDegradacion', 'Degradación por envejecimiento'],
    ['trasOhmicaDC', 'Pérdida óhmica DC → energía virtual en el MPP'],
  ];
  const onGrid: [string, string][] = [
    ['trasVentanaMPPT', 'Inversor: ventana de voltaje MPPT'],
    ['trasCorrienteMax', 'Inversor: corriente máxima de entrada'],
    ['trasUmbral', 'Inversor: umbral de potencia'],
    ['trasSobrepotencia', 'Inversor: sobrepotencia (recorte)'],
    ['trasEficienciaInv', 'Inversor: eficiencia de operación'],
    ['trasOhmicaAC', 'Pérdida óhmica AC'],
    ['eRed', 'Indisponibilidad → energía a la red'],
  ];
  const offGrid: [string, string][] = [
    ['trasRegulador', 'Regulador: eficiencia'],
    ['trasLimiteRegulador', 'Regulador: límite de corriente'],
    ['fvUtilizada', 'Energía no utilizada (batería llena)'],
    ['trasBateria', 'Batería: pérdidas de eficiencia'],
    ['trasAlmacenada', 'Variación de energía almacenada'],
    ['aCarga', 'Inversor y consumo en vacío → energía a la carga'],
  ];
  const pasos: PasoCascada[] = [];
  let previo = 0;
  irr.forEach(([k, etiqueta], idx) => {
    const v = (acc[k] ?? 0) / 1000;
    pasos.push({ clave: k, etiqueta, tipo: 'irradiacion', valor: v, variacion: idx === 0 || previo === 0 ? 0 : v / previo - 1 });
    previo = v;
  });
  previo = 0;
  [...comunes, ...(tipo === 'on-grid' ? onGrid : offGrid)].forEach(([k, etiqueta], idx) => {
    const v = (acc[k] ?? 0) / 1000;
    const base = previo;
    // El primer paso es la conversión con la eficiencia STC (no es una pérdida)
    pasos.push({ clave: k, etiqueta, tipo: 'energia', valor: v, variacion: idx === 0 || base <= 0 ? 0 : v / base - 1 });
    previo = v;
  });
  return pasos;
}
