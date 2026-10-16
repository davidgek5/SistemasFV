/** Lectores de PVGIS / NASA POWER: ida y vuelta con archivos construidos en los formatos oficiales. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { leerArchivoClima, rotarALocal, quitarBisiesto, limpiar, climaACsv } from './lectores';
import { resumenMensual } from './resumen';
import { GET as proxyPVGIS } from '../../api/pvgis-tmy';
import type { DatosClima } from '@/engine/tipos';

const local: DatosClima = JSON.parse(readFileSync(new URL('../../public/data/ibarra-sintetico.json', import.meta.url), 'utf8'));
const aUTC = (v: number[]) => rotarALocal(v, 5); // inversa de −5
const pad = (n: number) => String(n).padStart(2, '0');
const fechaUTC = (i: number, anio = 2015) => {
  const d = new Date(Date.UTC(anio, 0, 1) + i * 3600e3);
  return { d, s: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}:${pad(d.getUTCHours())}00` };
};

describe('rotación y limpieza', () => {
  it('rotarALocal es invertible', () => {
    const v = Array.from({ length: 8760 }, (_, i) => i);
    expect(rotarALocal(rotarALocal(v, -5), 5)).toEqual(v);
    expect(rotarALocal(v, -5)[0]).toBe(5); // 00:00 local = 05:00 UTC
  });
  it('quita el 29 de febrero', () => {
    const v = Array.from({ length: 8784 }, (_, i) => i);
    const r = quitarBisiesto(v);
    expect(r).toHaveLength(8760);
    expect(r[59 * 24]).toBe(60 * 24);
  });
  it('interpola temperaturas faltantes y anula irradiancia faltante', () => {
    expect(limpiar([10, -999, -999, 16], 'continua').v).toEqual([10, 12, 14, 16]);
    expect(limpiar([5, -999, 7], 'irradiancia').v).toEqual([5, 0, 7]);
  });
});

describe('PVGIS TMY', () => {
  const ghi = aUTC(local.ghi), dni = aUTC(local.dni), dhi = aUTC(local.dhi), ta = aUTC(local.tamb), ws = aUTC(local.viento);
  it('JSON de la API', () => {
    const j = {
      inputs: { location: { latitude: 0.35, longitude: -78.12, elevation: 2225 }, meteo_data: { radiation_db: 'PVGIS-SARAH3' } },
      outputs: {
        months_selected: Array.from({ length: 12 }, (_, m) => ({ month: m + 1, year: 2010 + m })),
        tmy_hourly: ghi.map((g, i) => ({ 'time(UTC)': fechaUTC(i).s, T2m: ta[i], RH: 70, 'G(h)': g, 'Gb(n)': dni[i], 'Gd(h)': dhi[i], 'IR(h)': 300, WS10m: ws[i], WD10m: 90, SP: 77000 })),
      },
      meta: {},
    };
    const { clima } = leerArchivoClima('tmy.json', JSON.stringify(j));
    expect(clima.fuente).toBe('pvgis-tmy');
    expect(clima.ghi).toEqual(local.ghi);
    expect(clima.dni).toEqual(local.dni);
    expect(clima.tamb).toEqual(local.tamb);
    expect(clima.origenMeses).toHaveLength(12);
  });
  it('CSV descargado de la web (con desfase de irradiancia)', () => {
    const lineas = [
      'Latitude (decimal degrees):\t0.350', 'Longitude (decimal degrees):\t-78.120', 'Elevation (m):\t2225',
      'Irradiance Time Offset (h):\t0.1761', 'month,year',
      ...Array.from({ length: 12 }, (_, m) => `${m + 1},${2010 + m}`),
      'time(UTC),T2m,RH,G(h),Gb(n),Gd(h),IR(h),WS10m,WD10m,SP',
      ...ghi.map((g, i) => `${fechaUTC(i).s},${ta[i]},70,${g},${dni[i]},${dhi[i]},300,${ws[i]},90,77000`),
      'T2m: 2-m air temperature (degree Celsius)', 'PVGIS (c) European Union, 2001-2024',
    ];
    const { clima } = leerArchivoClima('tmy.csv', lineas.join('\r\n'));
    expect(clima.latitud).toBeCloseTo(0.35);
    expect(clima.desfaseSolarHoras).toBeCloseTo(0.1761);
    expect(clima.ghi).toEqual(local.ghi);
  });
});

describe('NASA POWER', () => {
  const ghi = aUTC(local.ghi);
  it('JSON horario (año bisiesto 2024 → 8760 h)', () => {
    const p: Record<string, Record<string, number>> = { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DNI: {}, ALLSKY_SFC_SW_DIFF: {}, T2M: {}, WS10M: {} };
    let k = 0;
    for (let i = 0; i < 8784; i++) {
      const { d } = fechaUTC(i, 2024);
      const clave = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}`;
      const bis = d.getUTCMonth() === 1 && d.getUTCDate() === 29;
      const j = bis ? 0 : k++;
      p.ALLSKY_SFC_SW_DWN[clave] = bis ? -999 : ghi[j];
      p.ALLSKY_SFC_SW_DNI[clave] = bis ? -999 : aUTC(local.dni)[j];
      p.ALLSKY_SFC_SW_DIFF[clave] = bis ? -999 : aUTC(local.dhi)[j];
      p.T2M[clave] = bis ? -999 : aUTC(local.tamb)[j];
      p.WS10M[clave] = bis ? -999 : aUTC(local.viento)[j];
    }
    const j = { type: 'Feature', geometry: { type: 'Point', coordinates: [-78.12, 0.35, 2300] }, properties: { parameter: p } };
    const { clima } = leerArchivoClima('nasa.json', JSON.stringify(j));
    expect(clima.fuente).toBe('nasa-power');
    expect(clima.ghi).toEqual(local.ghi);
    expect(clima.altitud).toBe(2300);
  });
  it('CSV sin DNI/DHI → Erbs', () => {
    const filas = ghi.map((g, i) => {
      const { d } = fechaUTC(i, 2023);
      return `${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()},${d.getUTCHours()},${g},15,2`;
    });
    const txt = ['-BEGIN HEADER-', 'NASA/POWER Source Native Resolution Hourly Data', 'Location: Latitude  0.35   Longitude -78.12', 'Elevation from MERRA-2: Average for 0.5 x 0.625 degree lat/lon region = 2510.3 meters', '-END HEADER-', 'YEAR,MO,DY,HR,ALLSKY_SFC_SW_DWN,T2M,WS2M', ...filas].join('\n');
    const { clima, avisos } = leerArchivoClima('nasa.csv', txt);
    expect(clima.latitud).toBeCloseTo(0.35);
    expect(clima.altitud).toBeCloseTo(2510.3);
    expect(avisos.some((a) => a.includes('Erbs'))).toBe(true);
    const sumaDhiDni = clima.dhi.reduce((a, b) => a + b, 0);
    expect(sumaDhiDni).toBeGreaterThan(0);
  });
});

describe('resumen y exportación', () => {
  it('resumen mensual suma la GHI anual', () => {
    const r = resumenMensual(local);
    expect(r.anual.ghi).toBeCloseTo(local.ghi.reduce((a, b) => a + b, 0) / 1000, 6);
    expect(r.meses[0].hsp).toBeCloseTo(r.meses[0].ghi / 31, 9);
  });
  it('CSV exportado tiene 8760 filas de datos', () => {
    expect(climaACsv(local).split('\n')).toHaveLength(8763);
  });
});

describe('proxy /api/pvgis-tmy', () => {
  it('rechaza coordenadas inválidas', async () => {
    const r = await proxyPVGIS(new Request('http://x/api/pvgis-tmy?lat=200&lon=0'));
    expect(r.status).toBe(400);
  });
});
