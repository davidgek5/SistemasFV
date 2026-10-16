/**
 * GET /api/pvgis-tmy?lat=0.35&lon=-78.12
 * Proxy del año meteorológico típico de PVGIS 5.3 (JRC). Devuelve el JSON original.
 * El TMY se calcula con el horizonte de PVGIS desactivado (usehorizon=0): el horizonte se aplica
 * en el motor de la app, para poder reemplazarlo por uno propio.
 */
import { coordenadas, reenviar } from './_lib/comun';

export const URL_PVGIS = 'https://re.jrc.ec.europa.eu/api/v5_3/';

export async function GET(req: Request): Promise<Response> {
  const c = coordenadas(new URL(req.url));
  if (c instanceof Response) return c;
  return reenviar(`${URL_PVGIS}tmy?lat=${c.lat}&lon=${c.lon}&usehorizon=0&outputformat=json`, 'PVGIS');
}
