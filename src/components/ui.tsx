/** Componentes de interfaz reutilizables. */
import { useEffect, useId, useState, type ReactNode } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Tarjeta({ titulo, subtitulo, acciones, children, className }: {
  titulo?: ReactNode; subtitulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cx('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 dark:border-slate-800 dark:bg-slate-900', className)}>
      {(titulo || acciones) && (
        <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {titulo && <h2 className="text-base font-semibold">{titulo}</h2>}
            {subtitulo && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitulo}</p>}
          </div>
          {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Boton({ children, onClick, variante = 'secundario', disabled, type = 'button', className, title }: {
  children: ReactNode; onClick?: () => void; variante?: 'primario' | 'secundario' | 'peligro' | 'fantasma';
  disabled?: boolean; type?: 'button' | 'submit'; className?: string; title?: string;
}) {
  const estilos = {
    primario: 'bg-solar-500 text-slate-950 hover:bg-solar-400 shadow-sm',
    secundario: 'border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700',
    peligro: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 dark:border-red-900 dark:bg-slate-800 dark:text-red-400',
    fantasma: 'hover:bg-slate-100 dark:hover:bg-slate-800',
  }[variante];
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      className={cx('inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50', estilos, className)}>
      {children}
    </button>
  );
}

/** Campo numérico con etiqueta y unidad. Mantiene el texto mientras se edita (admite coma decimal). */
export function CampoNumero({ etiqueta, valor, onChange, unidad, min, max, paso, ayuda, decimales, ancho, disabled }: {
  etiqueta: ReactNode; valor: number; onChange: (v: number) => void; unidad?: string; min?: number; max?: number;
  paso?: number; ayuda?: ReactNode; decimales?: number; ancho?: string; disabled?: boolean;
}) {
  const id = useId();
  const mostrar = (v: number) => (Number.isFinite(v) ? (decimales !== undefined ? String(Number(v.toFixed(decimales))) : String(v)) : '');
  const [texto, setTexto] = useState(mostrar(valor));
  const [editando, setEditando] = useState(false);
  useEffect(() => {
    if (!editando) setTexto(mostrar(valor));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valor, editando]);
  const confirmar = (t: string) => {
    const v = Number(t.replace(',', '.'));
    if (t.trim() === '' || !Number.isFinite(v)) return setTexto(mostrar(valor));
    let r = v;
    if (min !== undefined) r = Math.max(min, r);
    if (max !== undefined) r = Math.min(max, r);
    if (r !== valor) onChange(r);
    setTexto(mostrar(r));
  };
  return (
    <div className={cx('min-w-0', ancho)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{etiqueta}</label>
      <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-300 bg-white focus-within:border-solar-500 focus-within:ring-2 focus-within:ring-solar-500/30 dark:border-slate-700 dark:bg-slate-950">
        <input id={id} type="text" inputMode="decimal" value={texto} disabled={disabled} step={paso}
          onFocus={() => setEditando(true)}
          onChange={(e) => setTexto(e.target.value)}
          onBlur={(e) => { setEditando(false); confirmar(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          className="tabular min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none disabled:opacity-60" />
        {unidad && <span className="flex items-center bg-slate-50 px-2.5 text-xs text-slate-500 dark:bg-slate-900 dark:text-slate-400">{unidad}</span>}
      </div>
      {ayuda && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ayuda}</p>}
    </div>
  );
}

export function CampoTexto({ etiqueta, valor, onChange, placeholder, ancho }: {
  etiqueta: ReactNode; valor: string; onChange: (v: string) => void; placeholder?: string; ancho?: string;
}) {
  const id = useId();
  return (
    <div className={cx('min-w-0', ancho)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{etiqueta}</label>
      <input id={id} value={valor} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-solar-500 focus:ring-2 focus:ring-solar-500/30 dark:border-slate-700 dark:bg-slate-950" />
    </div>
  );
}

export function Selector<T extends string>({ etiqueta, valor, opciones, onChange, ancho, ayuda }: {
  etiqueta: ReactNode; valor: T; opciones: { valor: T; texto: string; disabled?: boolean }[]; onChange: (v: T) => void; ancho?: string; ayuda?: ReactNode;
}) {
  const id = useId();
  return (
    <div className={cx('min-w-0', ancho)}>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-400">{etiqueta}</label>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value as T)}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-solar-500 focus:ring-2 focus:ring-solar-500/30 dark:border-slate-700 dark:bg-slate-950">
        {opciones.map((o) => <option key={o.valor} value={o.valor} disabled={o.disabled}>{o.texto}</option>)}
      </select>
      {ayuda && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{ayuda}</p>}
    </div>
  );
}

export function Segmentado<T extends string>({ valor, opciones, onChange }: {
  valor: T; opciones: { valor: T; texto: string; disabled?: boolean; titulo?: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap rounded-xl border border-slate-300 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
      {opciones.map((o) => (
        <button key={o.valor} type="button" disabled={o.disabled} title={o.titulo} onClick={() => onChange(o.valor)}
          className={cx('min-h-9 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40',
            o.valor === valor ? 'bg-white shadow-sm dark:bg-slate-950' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white')}>
          {o.texto}
        </button>
      ))}
    </div>
  );
}

export function Indicador({ etiqueta, valor, unidad, detalle, tono = 'normal' }: {
  etiqueta: ReactNode; valor: ReactNode; unidad?: string; detalle?: ReactNode; tono?: 'normal' | 'bien' | 'aviso' | 'mal';
}) {
  const color = { normal: '', bien: 'text-emerald-600 dark:text-emerald-400', aviso: 'text-amber-600 dark:text-amber-400', mal: 'text-red-600 dark:text-red-400' }[tono];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div className="text-xs text-slate-500 dark:text-slate-400">{etiqueta}</div>
      <div className={cx('tabular mt-1 text-xl font-semibold leading-tight', color)}>
        {valor}{unidad && <span className="ml-1 text-sm font-normal text-slate-500 dark:text-slate-400">{unidad}</span>}
      </div>
      {detalle && <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{detalle}</div>}
    </div>
  );
}

export function Aviso({ tipo = 'info', children }: { tipo?: 'info' | 'aviso' | 'error' | 'ok'; children: ReactNode }) {
  const estilos = {
    info: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200',
    aviso: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
    error: 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  }[tipo];
  return <div className={cx('rounded-xl border px-3 py-2 text-sm', estilos)}>{children}</div>;
}

export function Insignia({ children, tono = 'gris' }: { children: ReactNode; tono?: 'gris' | 'verde' | 'ambar' | 'rojo' | 'azul' }) {
  const t = {
    gris: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    verde: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
    ambar: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
    rojo: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
    azul: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  }[tono];
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function Rejilla({ children, cols = 'grid-cols-2 lg:grid-cols-4' }: { children: ReactNode; cols?: string }) {
  return <div className={cx('grid gap-2 sm:gap-3', cols)}>{children}</div>;
}

export function Tabla({ cabeceras, filas, pie, alinear }: {
  cabeceras: ReactNode[]; filas: ReactNode[][]; pie?: ReactNode[]; alinear?: ('izq' | 'der')[];
}) {
  const al = (i: number) => ((alinear?.[i] ?? (i === 0 ? 'izq' : 'der')) === 'der' ? 'text-right' : 'text-left');
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="tabular w-full min-w-max text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            {cabeceras.map((c, i) => <th key={i} className={cx('px-3 py-2 font-medium first:pl-4 sm:first:pl-3', al(i))}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, j) => (
            <tr key={j} className="border-b border-slate-100 last:border-0 dark:border-slate-800/60">
              {f.map((c, i) => <td key={i} className={cx('px-3 py-1.5 first:pl-4 sm:first:pl-3', al(i))}>{c}</td>)}
            </tr>
          ))}
        </tbody>
        {pie && (
          <tfoot>
            <tr className="border-t-2 border-slate-200 font-semibold dark:border-slate-700">
              {pie.map((c, i) => <td key={i} className={cx('px-3 py-2 first:pl-4 sm:first:pl-3', al(i))}>{c}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

export function Interruptor({ etiqueta, valor, onChange, disabled, ayuda }: { etiqueta: ReactNode; valor: boolean; onChange: (v: boolean) => void; disabled?: boolean; ayuda?: ReactNode }) {
  return (
    <label className={cx('flex items-start gap-3', disabled && 'opacity-50')}>
      <button type="button" role="switch" aria-checked={valor} disabled={disabled} onClick={() => onChange(!valor)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition', valor ? 'bg-solar-500' : 'bg-slate-300 dark:bg-slate-700')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition', valor ? 'left-5.5' : 'left-0.5')} />
      </button>
      <span className="text-sm">
        {etiqueta}
        {ayuda && <span className="block text-xs text-slate-500 dark:text-slate-400">{ayuda}</span>}
      </span>
    </label>
  );
}
