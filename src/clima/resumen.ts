/** Resumen mensual de un año meteorológico. */
import { DIAS_MES, MES_DE_HORA } from '@/engine/calendario';
import { HORAS_ANIO, type DatosClima } from '@/engine/tipos';

export interface FilaResumenClima {
  mes: number;
  ghi: number; // kWh/m²·mes
  dhi: number;
  dni: number;
  hsp: number; // kWh/m²·día (= horas solares pico sobre horizontal)
  tamb: number; // °C media
  tmin: number;
  tmax: number;
  viento: number;
}

export function resumenMensual(c: DatosClima): { meses: FilaResumenClima[]; anual: FilaResumenClima } {
  const meses: FilaResumenClima[] = Array.from({ length: 12 }, (_, m) => ({
    mes: m, ghi: 0, dhi: 0, dni: 0, hsp: 0, tamb: 0, tmin: Infinity, tmax: -Infinity, viento: 0,
  }));
  for (let i = 0; i < HORAS_ANIO; i++) {
    const r = meses[MES_DE_HORA[i]];
    r.ghi += c.ghi[i];
    r.dhi += c.dhi[i];
    r.dni += c.dni[i];
    r.tamb += c.tamb[i];
    r.viento += c.viento[i];
    r.tmin = Math.min(r.tmin, c.tamb[i]);
    r.tmax = Math.max(r.tmax, c.tamb[i]);
  }
  for (const r of meses) {
    const h = DIAS_MES[r.mes] * 24;
    r.ghi /= 1000;
    r.dhi /= 1000;
    r.dni /= 1000;
    r.hsp = r.ghi / DIAS_MES[r.mes];
    r.tamb /= h;
    r.viento /= h;
  }
  const anual: FilaResumenClima = {
    mes: -1,
    ghi: meses.reduce((a, r) => a + r.ghi, 0),
    dhi: meses.reduce((a, r) => a + r.dhi, 0),
    dni: meses.reduce((a, r) => a + r.dni, 0),
    hsp: meses.reduce((a, r) => a + r.ghi, 0) / 365,
    tamb: c.tamb.reduce((a, b) => a + b, 0) / HORAS_ANIO,
    tmin: Math.min(...meses.map((r) => r.tmin)),
    tmax: Math.max(...meses.map((r) => r.tmax)),
    viento: c.viento.reduce((a, b) => a + b, 0) / HORAS_ANIO,
  };
  return { meses, anual };
}
