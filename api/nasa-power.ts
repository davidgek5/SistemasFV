/**
 * GET /api/nasa-power?lat=0.35&lon=-78.12&anio=2023        → datos horarios de un año (UTC)
 * GET /api/nasa-power?lat=0.35&lon=-78.12&tipo=climatologia → climatología mensual
 * Comunidad RE (energías renovables). Devuelve el JSON original de NASA POWER.
 */
import { coordenadas, error, reenviar } from './_lib/comun';

const BASE = 'https://power.larc.nasa.gov/api/temporal/';
const HORARIO = 'ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M';
const CLIMA = 'ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,T2M_MIN,T2M_MAX,WS10M';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const c = coordenadas(url);
  if (c instanceof Response) return c;
  if (url.searchParams.get('tipo') === 'climatologia') {
    return reenviar(`${BASE}climatology/point?parameters=${CLIMA}&community=RE&longitude=${c.lon}&latitude=${c.lat}&format=JSON`, 'NASA POWER');
  }
  const anio = Number(url.searchParams.get('anio'));
  const actual = new Date().getUTCFullYear();
  if (!Number.isInteger(anio) || anio < 2001 || anio > actual - 1) return error(400, `Año inválido: use 2001–${actual - 1}.`);
  return reenviar(
    `${BASE}hourly/point?parameters=${HORARIO}&community=RE&longitude=${c.lon}&latitude=${c.lat}&start=${anio}0101&end=${anio}1231&format=JSON&time-standard=UTC`,
    'NASA POWER',
  );
}
