import { StrictMode, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import { Layout } from '@/components/Layout';
import { useProyecto } from '@/proyecto/store';
import { db } from '@/proyecto/db';
import { PaginaProyectos } from '@/features/inicio/PaginaProyectos';

const PaginaUbicacion = lazy(() => import('@/features/ubicacion/PaginaUbicacion'));
const PaginaCarga = lazy(() => import('@/features/carga/PaginaCarga'));
const PaginaSistema = lazy(() => import('@/features/sistema/PaginaSistema'));
const PaginaResultados = lazy(() => import('@/features/resultados/PaginaResultados'));
const PaginaEquipos = lazy(() => import('@/features/equipos/PaginaEquipos'));

const CLAVE_ULTIMO = 'sfv:ultimoProyecto';

/** Reabre el último proyecto al recargar la página. */
function Restaurar({ children }: { children: ReactNode }) {
  const [listo, setListo] = useState(false);
  const proyecto = useProyecto((s) => s.proyecto);
  const abrir = useProyecto((s) => s.abrir);
  useEffect(() => {
    let id: string | null = null;
    try { id = localStorage.getItem(CLAVE_ULTIMO); } catch { /* sin almacenamiento */ }
    if (!id) return setListo(true);
    db.proyectos.get(id).then((p) => { if (p) abrir(p); }).finally(() => setListo(true));
  }, [abrir]);
  useEffect(() => {
    try {
      if (proyecto) localStorage.setItem(CLAVE_ULTIMO, proyecto.id);
    } catch { /* sin almacenamiento */ }
  }, [proyecto?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return listo ? <>{children}</> : null;
}

function ConProyecto({ children }: { children: ReactNode }) {
  const proyecto = useProyecto((s) => s.proyecto);
  return proyecto ? <>{children}</> : <Navigate to="/" replace />;
}

const Cargando = () => <div className="py-20 text-center text-sm text-slate-500">Cargando…</div>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Restaurar>
        <Suspense fallback={<Cargando />}>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<PaginaProyectos />} />
              <Route path="ubicacion" element={<ConProyecto><PaginaUbicacion /></ConProyecto>} />
              <Route path="carga" element={<ConProyecto><PaginaCarga /></ConProyecto>} />
              <Route path="sistema" element={<ConProyecto><PaginaSistema /></ConProyecto>} />
              <Route path="resultados" element={<ConProyecto><PaginaResultados /></ConProyecto>} />
              <Route path="equipos" element={<PaginaEquipos />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </Restaurar>
    </BrowserRouter>
  </StrictMode>,
);
