/**
 * Perfil de carga horario (8760 h) a partir de una lista de equipos o de consumos mensuales.
 *
 * Supuestos (modo equipos):
 *  - Cada equipo reparte sus horas de uso uniformemente dentro de su franja horaria.
 *    Energía en la hora h = P · n · horas / duración_franja.
 *  - Potencia pico simultánea = máximo horario de la suma de potencias nominales de los
 *    equipos cuya franja incluye esa hora (peor caso: todos encendidos a la vez).
 *  - Potencia de arranque = pico simultáneo + (factor − 1) · P del motor más exigente
 *    (se supone que arranca un motor a la vez).
 */
import { DIAS_MES, esFinDeSemana } from '../calendario';
import { HORAS_ANIO, type DefinicionCarga, type EquipoCarga, type PerfilTipico } from '../tipos';

export function horasFranja(e: Pick<EquipoCarga, 'inicio' | 'fin'>): number[] {
  const ini = ((Math.round(e.inicio) % 24) + 24) % 24;
  let fin = Math.round(e.fin);
  if (fin <= ini) fin += 24;
  const horas: number[] = [];
  for (let h = ini; h < Math.min(fin, ini + 24); h++) horas.push(h % 24);
  return horas;
}

export interface PerfilDiario {
  laborable: number[]; // 24 valores, W promedio
  finDeSemana: number[];
}

export interface EstadisticasCarga {
  energiaDiariaLaborable: number; // Wh/día
  energiaDiariaFinDeSemana: number;
  energiaDiariaPromedio: number;
  energiaAnual: number; // kWh
  potenciaPicoSimultanea: number; // W
  potenciaArranque: number; // W
  avisos: string[];
}

export function perfilDiarioEquipos(equipos: EquipoCarga[]): PerfilDiario & { picoLab: number[]; picoFds: number[]; avisos: string[] } {
  const laborable = new Array(24).fill(0);
  const finDeSemana = new Array(24).fill(0);
  const picoLab = new Array(24).fill(0);
  const picoFds = new Array(24).fill(0);
  const avisos: string[] = [];
  for (const e of equipos) {
    const horas = horasFranja(e);
    const p = e.potencia * e.cantidad;
    for (const [tipo, hUso, perfil, pico] of [
      ['laborable', e.horasLaborable, laborable, picoLab],
      ['fin de semana', e.horasFinDeSemana, finDeSemana, picoFds],
    ] as const) {
      if (hUso <= 0) continue;
      let h = hUso;
      if (h > horas.length) {
        avisos.push(`«${e.nombre}»: ${hUso} h de uso (${tipo}) superan la franja de ${horas.length} h; se limita a la franja.`);
        h = horas.length;
      }
      const frac = h / horas.length;
      for (const hh of horas) {
        perfil[hh] += p * frac;
        pico[hh] += p;
      }
    }
  }
  return { laborable, finDeSemana, picoLab, picoFds, avisos };
}

/** Perfiles típicos normalizados (suma = 1). Residencial: pico nocturno; comercial: horario de oficina. */
export const PERFILES_TIPICOS: Record<PerfilTipico, { laborable: number[]; finDeSemana: number[] }> = (() => {
  const norm = (a: number[]) => {
    const s = a.reduce((x, y) => x + y, 0);
    return a.map((x) => x / s);
  };
  return {
    residencial: {
      laborable: norm([2.2, 2, 1.9, 1.9, 2, 2.6, 3.8, 4.4, 3.6, 3, 2.9, 3, 3.3, 3.2, 3, 3, 3.3, 4.2, 6, 6.8, 6.5, 5.6, 4.2, 2.9]),
      finDeSemana: norm([2.4, 2.1, 2, 1.9, 1.9, 2.1, 2.7, 3.4, 4, 4.2, 4.1, 4.2, 4.5, 4.3, 3.9, 3.7, 3.8, 4.4, 5.7, 6.3, 6.1, 5.3, 4.1, 3]),
    },
    comercial: {
      laborable: norm([1.5, 1.4, 1.4, 1.4, 1.5, 2, 3.5, 6, 8, 8.5, 8.7, 8.8, 8.2, 8.5, 8.7, 8.5, 8, 6.5, 4, 2.8, 2.2, 1.9, 1.7, 1.6]),
      finDeSemana: norm([1.5, 1.4, 1.4, 1.4, 1.5, 1.7, 2.2, 3, 4, 4.5, 4.6, 4.6, 4.3, 3.8, 3.5, 3.2, 2.9, 2.6, 2.2, 1.9, 1.8, 1.7, 1.6, 1.5]),
    },
    plano: { laborable: new Array(24).fill(1 / 24), finDeSemana: new Array(24).fill(1 / 24) },
  };
})();

/** Genera la serie de 8760 h (W promedio por hora) y sus estadísticas. */
export function generarCarga(def: DefinicionCarga, anioReferencia: number): { serie: number[]; estadisticas: EstadisticasCarga; perfil: PerfilDiario } {
  const serie = new Array<number>(HORAS_ANIO).fill(0);
  const avisos: string[] = [];
  let perfil: PerfilDiario;
  let pico = 0;
  let arranque = 0;

  if (def.modo === 'equipos') {
    const d = perfilDiarioEquipos(def.equipos);
    avisos.push(...d.avisos);
    perfil = { laborable: d.laborable, finDeSemana: d.finDeSemana };
    for (let dia = 0; dia < 365; dia++) {
      const p = esFinDeSemana(anioReferencia, dia) ? d.finDeSemana : d.laborable;
      for (let h = 0; h < 24; h++) serie[dia * 24 + h] = p[h];
    }
    pico = Math.max(0, ...d.picoLab, ...d.picoFds);
    const extraMotor = Math.max(0, ...def.equipos.map((e) => (Math.max(1, e.factorArranque) - 1) * e.potencia));
    arranque = pico + extraMotor;
  } else {
    const base = PERFILES_TIPICOS[def.perfil];
    const valores = def.consumoMensualKWh.length === 12 ? def.consumoMensualKWh : new Array(12).fill(def.consumoMensualKWh[0] ?? 0);
    // Peso relativo de los días de fin de semana (energía diaria) según el perfil
    const pesoFds = def.perfil === 'comercial' ? 0.45 : def.perfil === 'residencial' ? 1.1 : 1;
    let dia0 = 0;
    for (let m = 0; m < 12; m++) {
      let nLab = 0;
      let nFds = 0;
      for (let d = 0; d < DIAS_MES[m]; d++) (esFinDeSemana(anioReferencia, dia0 + d) ? nFds++ : nLab++);
      const eLab = (valores[m] * 1000) / (nLab + pesoFds * nFds); // Wh/día laborable
      for (let d = 0; d < DIAS_MES[m]; d++) {
        const fds = esFinDeSemana(anioReferencia, dia0 + d);
        const e = fds ? eLab * pesoFds : eLab;
        const forma = fds ? base.finDeSemana : base.laborable;
        for (let h = 0; h < 24; h++) serie[(dia0 + d) * 24 + h] = e * forma[h];
      }
      dia0 += DIAS_MES[m];
    }
    const eMedia = valores.reduce((a, b) => a + b, 0) * 1000 / 365;
    perfil = { laborable: base.laborable.map((x) => x * eMedia), finDeSemana: base.finDeSemana.map((x) => x * eMedia * pesoFds) };
    pico = Math.max(...serie);
    arranque = pico;
    avisos.push('Modo factura: la potencia pico es el máximo horario promedio; los picos instantáneos pueden ser mayores.');
  }

  const eLab = perfil.laborable.reduce((a, b) => a + b, 0);
  const eFds = perfil.finDeSemana.reduce((a, b) => a + b, 0);
  const total = serie.reduce((a, b) => a + b, 0);
  return {
    serie,
    perfil,
    estadisticas: {
      energiaDiariaLaborable: eLab,
      energiaDiariaFinDeSemana: eFds,
      energiaDiariaPromedio: total / 365,
      energiaAnual: total / 1000,
      potenciaPicoSimultanea: pico,
      potenciaArranque: arranque,
      avisos,
    },
  };
}
