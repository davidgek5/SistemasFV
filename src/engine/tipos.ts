/** Tipos compartidos por el motor de simulación. Todo es serializable en JSON. */
import type { ModeloIAM } from './irradiancia/iam';
import type { ParametrosTermicos } from './termico/faiman';
import type { PerfilHorizonte } from './horizonte/horizonte';
import type { ParametrosBifacial } from './bifacial/bifacial';
import type { ParametrosCEC } from './modulo/unDiodo';
import type { ParametrosSandia } from './inversor/sandia';

export const HORAS_ANIO = 8760;

// ───────────────────────── Clima ─────────────────────────

export type FuenteClima = 'pvgis-tmy' | 'pvgis-serie' | 'nasa-power' | 'csv-pvgis' | 'csv-nasa' | 'csv-generico' | 'sintetico' | 'promedio';

/**
 * Año meteorológico de 8760 h en HORA LOCAL (índice 0 = 1 de enero 00:00–01:00 local).
 * Los valores son promedios horarios (W/m², °C, m/s).
 */
export interface DatosClima {
  fuente: FuenteClima;
  descripcion: string;
  latitud: number;
  longitud: number;
  altitud: number;
  husoHorario: number; // horas respecto a UTC (Ecuador continental: −5)
  /**
   * Horas después de la marca de tiempo del dato en que se evalúa la posición solar.
   * 0.5 = promedio de [hh:00, hh+1:00) evaluado a mitad de hora (PVsyst).
   * PVGIS 5.3 informa su propio desfase ("Irradiance Time Offset").
   */
  desfaseSolarHoras: number;
  anioReferencia: number; // año no bisiesto usado para el calendario (día de la semana)
  ghi: number[];
  dni: number[];
  dhi: number[];
  tamb: number[];
  viento: number[];
  /** Meses de origen (TMY) o año de los datos, solo informativo. */
  origenMeses?: { mes: number; anio: number }[];
  /** Año real de los datos (series anuales de NASA POWER o PVGIS). */
  anioDatos?: number;
}

/** Serie meteorológica de un año real (NASA POWER o PVGIS seriescalc). */
export type FuenteSerie = 'nasa-power' | 'pvgis-serie';

export interface SerieAnual {
  fuente: FuenteSerie;
  anio: number;
  clima: DatosClima;
}

// ───────────────────────── Equipos ─────────────────────────

export interface Modulo {
  id: string;
  origen: 'cec' | 'usuario';
  fabricante: string;
  modelo: string;
  tecnologia: string;
  bifacial: boolean;
  pNom: number; // W STC
  area: number; // m²
  largo?: number | null;
  ancho?: number | null;
  Ns?: number | null;
  Isc: number;
  Voc: number;
  Imp: number;
  Vmp: number;
  alphaSc: number; // A/K
  betaVoc: number; // V/K
  gammaPmp: number; // %/K
  tNoct?: number | null;
  cec: ParametrosCEC;
  factorBifacialidad?: number | null;
  precio?: number | null;
}

export interface InversorRed {
  id: string;
  origen: 'cec' | 'usuario';
  fabricante: string;
  modelo: string;
  vac: number;
  fases: number;
  sandia: ParametrosSandia;
  vdcMaxEntrada?: number | null; // V máx. absoluto de entrada (ficha técnica), para validar Voc
  idcMaxEntrada?: number | null; // A máx. de entrada total del inversor (ficha técnica; suma de MPPT)
  numMppt?: number | null;
  precio?: number | null;
}

export type QuimicaBateria = 'LiFePO4' | 'plomo-acido-AGM' | 'plomo-acido-GEL' | 'plomo-acido-OPzS';

export interface Bateria {
  id: string;
  origen: 'base' | 'usuario';
  fabricante: string;
  modelo: string;
  quimica: QuimicaBateria;
  voltajeNominal: number; // V
  capacidadAh: number; // Ah (C10 para plomo, nominal para Li)
  energiaKWh: number;
  dodRecomendada: number; // fracción
  eficienciaIda: number; // eficiencia de ida y vuelta (round-trip)
  corrienteCargaMaxA: number;
  corrienteDescargaMaxA: number;
  ciclosVida: number; // a la DoD recomendada
  precio?: number | null;
  nota?: string;
}

export interface Regulador {
  id: string;
  origen: 'base' | 'usuario';
  fabricante: string;
  modelo: string;
  tipo: 'MPPT' | 'PWM';
  vocMax: number; // V entrada FV máx.
  corrienteSalidaA: number; // A al banco
  voltajesBateria: number[]; // 12/24/48
  eficiencia: number;
  precio?: number | null;
  nota?: string;
}

export interface InversorAislado {
  id: string;
  origen: 'base' | 'usuario';
  fabricante: string;
  modelo: string;
  tipo: 'off-grid' | 'hibrido';
  potenciaNominalW: number;
  potenciaPicoW: number; // sobrecarga de arranque (≈ 5 s)
  voltajeBateria: number;
  eficiencia: number; // europea / máxima
  consumoVacioW: number;
  mpptIntegrado?: { vocMax: number; vMpptMin: number; vMpptMax: number; potenciaFVMaxW: number; corrienteMaxA: number } | null;
  precio?: number | null;
  nota?: string;
}

// ───────────────────────── Carga ─────────────────────────

export interface EquipoCarga {
  id: string;
  nombre: string;
  potencia: number; // W
  cantidad: number;
  horasLaborable: number; // h/día
  horasFinDeSemana: number; // h/día
  inicio: number; // hora 0–23 (inicio de la franja)
  fin: number; // hora 1–24 (fin de la franja; si fin ≤ inicio la franja cruza la medianoche)
  factorArranque: number; // 1 = sin motor; 3–7 típico para motores
}

export type PerfilTipico = 'residencial' | 'comercial' | 'plano';

export type DefinicionCarga =
  | { modo: 'equipos'; equipos: EquipoCarga[] }
  | { modo: 'mensual'; consumoMensualKWh: number[]; perfil: PerfilTipico };

// ───────────────────────── Sistema ─────────────────────────

export interface Perdidas {
  suciedad: number; // fracción
  sombraDirecta: number; // fracción de la directa + circunsolar perdida por sombras cercanas
  sombraDifusa: number; // fracción de la difusa perdida por sombras cercanas
  calidadModulo: number; // fracción (negativa = ganancia)
  lid: number;
  mismatch: number;
  ohmicaDC: number; // fracción a STC
  ohmicaAC: number; // fracción a potencia nominal AC
  indisponibilidad: number;
  degradacionAnual: number;
  anioOperacion: number; // 1 = primer año
}

export const PERDIDAS_POR_DEFECTO: Perdidas = {
  suciedad: 0.02,
  sombraDirecta: 0,
  sombraDifusa: 0,
  calidadModulo: -0.004,
  lid: 0.01,
  mismatch: 0.02,
  ohmicaDC: 0.015,
  ohmicaAC: 0.01,
  indisponibilidad: 0,
  degradacionAnual: 0.004,
  anioOperacion: 1,
};

export interface Generador {
  modulo: Modulo;
  modeloModulo: 'cec' | 'pvwatts';
  nSerie: number;
  nParalelo: number; // número total de strings
  inclinacion: number;
  azimut: number; // convención PVsyst
  albedo: number[]; // 12 valores mensuales
  termico: ParametrosTermicos;
  iam: ModeloIAM;
  horizonte: PerfilHorizonte;
  bifacial: ParametrosBifacial;
  perdidas: Perdidas;
}

export type ModalidadRed = 'autoconsumo' | 'balanceNeto';

export interface SistemaOnGrid {
  tipo: 'on-grid';
  inversor: InversorRed;
  nInversores: number;
  modalidad: ModalidadRed;
}

export interface BancoBaterias {
  bateria: Bateria;
  nSerie: number;
  nParalelo: number;
  socMin: number; // fracción (1 − DoD)
  socMax: number;
  socInicial: number;
}

export interface SistemaOffGrid {
  tipo: 'off-grid';
  banco: BancoBaterias;
  regulador: Regulador;
  nReguladores: number;
  inversor: InversorAislado;
}

export interface SistemaHibrido {
  tipo: 'hibrido';
  banco: BancoBaterias;
  inversor: InversorAislado;
  estrategia: 'prioridadSolar' | 'soloRespaldo' | 'recortePicos';
}

export type Sistema = SistemaOnGrid | SistemaOffGrid | SistemaHibrido;

export interface EntradaSimulacion {
  clima: DatosClima;
  carga: number[]; // W promedio por hora (8760), ya generada
  generador: Generador;
  sistema: Sistema;
}

// ───────────────────────── Resultados ─────────────────────────

/** Cascada de pérdidas al estilo PVsyst (energías anuales). */
export interface PasoCascada {
  clave: string;
  etiqueta: string;
  tipo: 'irradiacion' | 'energia';
  valor: number; // kWh/m² (irradiación) o kWh (energía) DESPUÉS del paso
  variacion: number; // fracción respecto al paso anterior (negativa = pérdida)
}

export interface ResumenMensual {
  mes: number;
  ghi: number; // kWh/m²
  poa: number; // kWh/m² (global incidente en el plano, antes de pérdidas)
  efectiva: number; // kWh/m²
  tamb: number; // °C promedio
  eDC: number; // kWh
  eSalida: number; // kWh (inyectada a red en on-grid / disponible para la carga en off-grid)
  carga: number; // kWh
  autoconsumo: number;
  inyeccion: number;
  compra: number;
  noSuministrada: number;
  desperdiciada: number;
  pr: number;
}

export interface ResultadoSimulacion {
  tipo: Sistema['tipo'];
  potenciaPicoKWp: number;
  potenciaACkW: number;
  horario: {
    poa: Float32Array;
    gEf: Float32Array;
    tCelda: Float32Array;
    pDC: Float32Array; // W
    pSalida: Float32Array; // W AC (on-grid) / W entregada a la carga (off-grid)
    carga: Float32Array;
    autoconsumo: Float32Array;
    inyeccion: Float32Array;
    compra: Float32Array;
    soc: Float32Array; // fracción (off-grid/híbrido)
    noSuministrada: Float32Array;
    desperdiciada: Float32Array;
  };
  mensual: ResumenMensual[];
  anual: {
    ghi: number;
    poa: number;
    eDC: number;
    eSalida: number;
    carga: number;
    autoconsumo: number;
    inyeccion: number;
    compra: number;
    noSuministrada: number;
    desperdiciada: number;
    rendimientoEspecifico: number; // kWh/kWp
    pr: number;
    fraccionSolar: number;
    tasaAutoconsumo: number; // autoconsumo / producción
    ciclosBateria: number;
    diasConDeficit: number;
    socPromedio: number;
    horasRecorte: number;
    balanceNeto?: { mes: number; facturadoKWh: number; creditoKWh: number }[];
  };
  cascada: PasoCascada[];
  avisos: string[];
  duracionMs: number;
}
