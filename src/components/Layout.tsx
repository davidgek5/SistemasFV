/** Estructura: barra lateral en PC, barra inferior en el celular. */
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useProyecto, useResultadoDesactualizado } from '@/proyecto/store';

const Icono = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export const ICONOS = {
  proyectos: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  ubicacion: 'M12 21s-7-6.2-7-12a7 7 0 1 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  carga: 'M13 2 4 14h7l-1 8 9-12h-7z',
  sistema: 'M3 17 7 7h14l-4 10zM8.5 12h11M12 7l-3 10M16.5 7l-3 10',
  resultados: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  equipos: 'M4 6h16M4 12h16M4 18h10',
};

interface Item { a: string; texto: string; icono: keyof typeof ICONOS; requiereProyecto?: boolean }

const ITEMS: Item[] = [
  { a: '/', texto: 'Proyectos', icono: 'proyectos' },
  { a: '/ubicacion', texto: 'Ubicación', icono: 'ubicacion', requiereProyecto: true },
  { a: '/carga', texto: 'Carga', icono: 'carga', requiereProyecto: true },
  { a: '/sistema', texto: 'Sistema', icono: 'sistema', requiereProyecto: true },
  { a: '/resultados', texto: 'Resultados', icono: 'resultados', requiereProyecto: true },
  { a: '/equipos', texto: 'Equipos', icono: 'equipos' },
];

function Enlace({ item, compacto, deshabilitado, punto }: { item: Item; compacto?: boolean; deshabilitado?: boolean; punto?: boolean }) {
  if (deshabilitado) {
    return (
      <span className={compacto ? 'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] text-slate-400 opacity-50' : 'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-400 opacity-50'}>
        <Icono d={ICONOS[item.icono]} />
        {item.texto}
      </span>
    );
  }
  return (
    <NavLink to={item.a} end={item.a === '/'}
      className={({ isActive }) =>
        compacto
          ? `relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-solar-600 dark:text-solar-400' : 'text-slate-500 dark:text-slate-400'}`
          : `relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${isActive ? 'bg-solar-100 text-solar-700 dark:bg-solar-500/15 dark:text-solar-400' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`
      }>
      <Icono d={ICONOS[item.icono]} />
      {item.texto}
      {punto && <span className={compacto ? 'absolute right-[calc(50%-14px)] top-1.5 h-2 w-2 rounded-full bg-amber-500' : 'ml-auto h-2 w-2 rounded-full bg-amber-500'} title="Resultados desactualizados" />}
    </NavLink>
  );
}

export function Layout(): ReactNode {
  const proyecto = useProyecto((s) => s.proyecto);
  const guardado = useProyecto((s) => s.guardado);
  const desactualizado = useResultadoDesactualizado();
  const navegar = useNavigate();
  return (
    <div className="min-h-dvh lg:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex dark:border-slate-800 dark:bg-slate-900">
        <button onClick={() => navegar('/')} className="mb-6 flex items-center gap-2 px-2 text-left">
          <img src="/icono.svg" alt="" className="h-8 w-8" />
          <span>
            <span className="block text-base font-bold leading-tight">SistemasFV</span>
            <span className="block text-xs text-slate-500">Simulación fotovoltaica</span>
          </span>
        </button>
        <nav className="flex flex-col gap-1">
          {ITEMS.map((it) => <Enlace key={it.a} item={it} deshabilitado={it.requiereProyecto && !proyecto} punto={it.a === '/resultados' && desactualizado} />)}
        </nav>
        {proyecto && (
          <div className="mt-auto rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
            <div className="truncate font-semibold">{proyecto.nombre}</div>
            <div className="mt-0.5 text-slate-500">{guardado === 'guardado' ? 'Guardado en este dispositivo' : guardado === 'pendiente' ? 'Guardando…' : 'Error al guardar'}</div>
          </div>
        )}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-4 py-2.5 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
          <img src="/icono.svg" alt="" className="h-7 w-7" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{proyecto?.nombre ?? 'SistemasFV'}</div>
            {proyecto && <div className="text-[11px] text-slate-500">{guardado === 'guardado' ? 'Guardado' : guardado === 'pendiente' ? 'Guardando…' : 'Error al guardar'}</div>}
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 sm:pt-6 lg:px-8 lg:pb-12">
          <Outlet />
        </main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/95">
        {ITEMS.filter((i) => i.a !== '/equipos').map((it) => (
          <Enlace key={it.a} item={it} compacto deshabilitado={it.requiereProyecto && !proyecto} punto={it.a === '/resultados' && desactualizado} />
        ))}
      </nav>
    </div>
  );
}

export function Titulo({ titulo, subtitulo, acciones }: { titulo: string; subtitulo?: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitulo}</p>}
      </div>
      {acciones && <div className="flex flex-wrap gap-2">{acciones}</div>}
    </div>
  );
}
