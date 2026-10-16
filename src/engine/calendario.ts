/** Calendario del año típico (365 días, 8760 h, hora local). */
import { HORAS_ANIO } from './tipos';

export const DIAS_MES = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
export const NOMBRES_MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const NOMBRES_MES_LARGO = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const INICIO_MES_DIA: number[] = DIAS_MES.reduce<number[]>((acc, _d, i) => {
  acc.push(i === 0 ? 0 : acc[i - 1] + DIAS_MES[i - 1]);
  return acc;
}, []);

/** Mes (0–11) de cada una de las 8760 horas. */
export const MES_DE_HORA: Uint8Array = (() => {
  const a = new Uint8Array(HORAS_ANIO);
  for (let m = 0; m < 12; m++) a.fill(m, INICIO_MES_DIA[m] * 24, (INICIO_MES_DIA[m] + DIAS_MES[m]) * 24);
  return a;
})();

export const diaDelAnio = (hora: number) => Math.floor(hora / 24) + 1; // 1–365
export const horaDelDia = (hora: number) => hora % 24;
export const inicioMesHora = (m: number) => INICIO_MES_DIA[m] * 24;

/** Día de la semana (0 = domingo … 6 = sábado) para el día d (0–364) de un año dado. */
export function diaSemana(anio: number, dia: number): number {
  return new Date(Date.UTC(anio, 0, 1 + dia)).getUTCDay();
}

export const esFinDeSemana = (anio: number, dia: number) => {
  const d = diaSemana(anio, dia);
  return d === 0 || d === 6;
};

/**
 * Instante Unix (s, UTC) en que se evalúa la posición solar para la hora i del año local.
 * desfase = 0.5 → el dato es el promedio de [hh:00, hh+1:00) y se evalúa en hh:30.
 */
export function unixHora(anio: number, i: number, husoHorario: number, desfaseHoras: number): number {
  return Date.UTC(anio, 0, 1) / 1000 + i * 3600 - husoHorario * 3600 + desfaseHoras * 3600;
}

/** Suma por mes de una serie horaria (factor de escala opcional, p. ej. 1/1000 para Wh→kWh). */
export function sumaMensual(serie: ArrayLike<number>, escala = 1): number[] {
  const out = new Array(12).fill(0);
  for (let i = 0; i < HORAS_ANIO; i++) out[MES_DE_HORA[i]] += serie[i];
  return out.map((x) => x * escala);
}

export function promedioMensual(serie: ArrayLike<number>): number[] {
  const s = sumaMensual(serie);
  return s.map((x, m) => x / (DIAS_MES[m] * 24));
}
