/** Formato numérico en español de Ecuador. */
const cache = new Map<string, Intl.NumberFormat>();
function nf(dec: number, min = dec): Intl.NumberFormat {
  const k = `${dec}-${min}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('es-EC', { maximumFractionDigits: dec, minimumFractionDigits: min });
    cache.set(k, f);
  }
  return f;
}

export const fmt = (x: number | null | undefined, dec = 0, min = dec) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : nf(dec, min).format(x);

export const pct = (x: number | null | undefined, dec = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? '—' : `${nf(dec, dec).format(x * 100)} %`;

/** Energía en kWh o MWh según magnitud. */
export const energia = (kWh: number) => (Math.abs(kWh) >= 10000 ? `${fmt(kWh / 1000, 2)} MWh` : `${fmt(kWh, kWh < 100 ? 1 : 0)} kWh`);

export const potencia = (W: number) => (Math.abs(W) >= 1000 ? `${fmt(W / 1000, 2)} kW` : `${fmt(W, 0)} W`);

export function descargarArchivo(nombre: string, contenido: string | Blob, tipo = 'application/json') {
  const blob = contenido instanceof Blob ? contenido : new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const nombreArchivo = (s: string) => s.normalize('NFD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'proyecto';
