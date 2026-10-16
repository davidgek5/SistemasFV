/**
 * GET /api/pvgis-horizonte?lat=0.35&lon=-78.12
 * Perfil de horizonte lejano de PVGIS (azimut 0 = sur, 90 = oeste; altura en grados).
 */
import { coordenadas, reenviar } from './_lib/comun';
import { URL_PVGIS } from './pvgis-tmy';

export async function GET(req: Request): Promise<Response> {
  const c = coordenadas(new URL(req.url));
  if (c instanceof Response) return c;
  return reenviar(`${URL_PVGIS}printhorizon?lat=${c.lat}&lon=${c.lon}&outputformat=json`, 'PVGIS');
}
