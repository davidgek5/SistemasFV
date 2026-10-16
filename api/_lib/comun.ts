/** Utilidades compartidas por las funciones serverless (Vercel, runtime Node con Web API). */

export const CACHE_30_DIAS = 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800';

export function error(status: number, mensaje: string, detalle?: unknown): Response {
  return new Response(JSON.stringify({ error: mensaje, detalle }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function json(texto: string, cache = CACHE_30_DIAS): Response {
  return new Response(texto, {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache, 'access-control-allow-origin': '*' },
  });
}

/** Lee lat/lon, valida rangos y redondea a 0.01° (≈ 1.1 km) para que el caché del CDN se reutilice. */
export function coordenadas(url: URL): { lat: number; lon: number } | Response {
  const lat = Number(url.searchParams.get('lat'));
  const lon = Number(url.searchParams.get('lon'));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return error(400, 'Parámetros lat/lon inválidos.');
  }
  return { lat: Math.round(lat * 100) / 100, lon: Math.round(lon * 100) / 100 };
}

/** fetch con tiempo límite. */
export async function obtener(url: string, ms = 25000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'SistemasFV/0.1 (+https://github.com/davidgek5/SistemasFV)' } });
  } finally {
    clearTimeout(t);
  }
}

export async function reenviar(urlOrigen: string, nombre: string): Promise<Response> {
  let r: Response;
  try {
    r = await obtener(urlOrigen);
  } catch (e) {
    return error(504, `${nombre} no respondió a tiempo.`, String(e));
  }
  const texto = await r.text();
  if (!r.ok) {
    let mensaje = texto.slice(0, 500);
    try {
      mensaje = JSON.parse(texto).message ?? mensaje;
    } catch { /* texto plano */ }
    return error(r.status === 400 ? 400 : 502, `${nombre} devolvió un error.`, mensaje);
  }
  return json(texto);
}
