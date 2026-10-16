/**
 * GET /api/pvgis-serie?lat=0.35&lon=-78.12&anio=2020
 * Serie horaria real de un año (PVGIS 5.3 seriescalc, plano horizontal, con componentes).
 * Un año por petición para que cada año se cachee por separado.
 */
import { coordenadas, error, reenviar } from './_lib/comun';
import { URL_PVGIS } from './pvgis-tmy';

export const ANIO_MIN = 2005;
export const ANIO_MAX = 2023;

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const c = coordenadas(url);
  if (c instanceof Response) return c;
  const anio = Number(url.searchParams.get('anio'));
  if (!Number.isInteger(anio) || anio < ANIO_MIN || anio > ANIO_MAX) return error(400, `Año inválido: PVGIS ofrece ${ANIO_MIN}–${ANIO_MAX}.`);
  return reenviar(
    `${URL_PVGIS}seriescalc?lat=${c.lat}&lon=${c.lon}&startyear=${anio}&endyear=${anio}&components=1&usehorizon=0&angle=0&outputformat=json`,
    'PVGIS',
  );
}
