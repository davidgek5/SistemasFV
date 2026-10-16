/** Lista de proyectos guardados en el dispositivo: crear, abrir, duplicar, borrar, exportar e importar. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Titulo } from '@/components/Layout';
import { Aviso, Boton, Insignia, Tarjeta } from '@/components/ui';
import { borrarProyecto, guardarProyecto, listarProyectos } from '@/proyecto/db';
import { nuevoId, proyectoNuevo } from '@/proyecto/porDefecto';
import { validarProyecto, type Proyecto } from '@/proyecto/esquema';
import { useProyecto } from '@/proyecto/store';
import { climaEjemplo } from '@/clima/servicio';
import { descargarArchivo, nombreArchivo } from '@/lib/formato';

const TIPOS = { 'on-grid': 'On-grid', 'off-grid': 'Off-grid', hibrido: 'Híbrido' } as const;

export function PaginaProyectos() {
  const [lista, setLista] = useState<Proyecto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abrir = useProyecto((s) => s.abrir);
  const actual = useProyecto((s) => s.proyecto);
  const cerrar = useProyecto((s) => s.cerrar);
  const navegar = useNavigate();
  const entrada = useRef<HTMLInputElement>(null);

  const recargar = () => listarProyectos().then(setLista).catch((e) => setError(String(e)));
  useEffect(() => { recargar(); }, [actual?.modificado]);

  const abrirYIr = (p: Proyecto, ruta = '/ubicacion') => {
    abrir(p);
    navegar(ruta);
  };

  const crear = async () => {
    const p = proyectoNuevo();
    await guardarProyecto(p);
    abrirYIr(p);
  };

  const crearEjemplo = async () => {
    const p = proyectoNuevo('Ejemplo Ibarra (clima sintético)');
    p.clima = await climaEjemplo();
    await guardarProyecto(p);
    abrirYIr(p, '/resultados');
  };

  const duplicar = async (p: Proyecto) => {
    const ahora = new Date().toISOString();
    const c = { ...structuredClone(p), id: nuevoId(), nombre: `${p.nombre} (copia)`, creado: ahora, modificado: ahora };
    await guardarProyecto(c);
    recargar();
  };

  const borrar = async (p: Proyecto) => {
    if (!confirm(`¿Borrar «${p.nombre}» de este dispositivo? Esta acción no se puede deshacer.`)) return;
    await borrarProyecto(p.id);
    if (actual?.id === p.id) cerrar();
    recargar();
  };

  const exportar = (p: Proyecto) => descargarArchivo(`${nombreArchivo(p.nombre)}.sfv.json`, JSON.stringify(p));

  const importar = async (f: File) => {
    setError(null);
    try {
      const p = validarProyecto(JSON.parse(await f.text()));
      const existe = lista.some((x) => x.id === p.id);
      const final = existe ? { ...p, id: nuevoId(), nombre: `${p.nombre} (importado)` } : p;
      await guardarProyecto(final);
      recargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <>
      <Titulo
        titulo="Proyectos"
        subtitulo="Se guardan en este dispositivo. Exporta el archivo .sfv.json para respaldarlo o abrirlo en otro equipo."
        acciones={
          <>
            <Boton onClick={() => entrada.current?.click()}>Importar</Boton>
            <Boton variante="primario" onClick={crear}>Nuevo proyecto</Boton>
          </>
        }
      />
      <input ref={entrada} type="file" accept=".json,application/json" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = ''; }} />
      {error && <div className="mb-4"><Aviso tipo="error">{error}</Aviso></div>}

      {lista.length === 0 ? (
        <Tarjeta>
          <div className="py-6 text-center">
            <p className="text-lg font-semibold">Todavía no hay proyectos</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">Crea uno nuevo (ubicación por defecto: Ibarra) o abre el ejemplo con datos climáticos sintéticos para ver la app funcionando sin internet.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Boton variante="primario" onClick={crear}>Nuevo proyecto</Boton>
              <Boton onClick={crearEjemplo}>Abrir ejemplo</Boton>
            </div>
          </div>
        </Tarjeta>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {lista.map((p) => (
            <Tarjeta key={p.id} className={actual?.id === p.id ? 'ring-2 ring-solar-500' : ''}>
              <button className="block w-full text-left" onClick={() => abrirYIr(p)}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{p.nombre}</h3>
                  <Insignia tono="azul">{TIPOS[p.tipoSistema]}</Insignia>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {p.ubicacion.nombre} · {p.generador.nSerie * p.generador.nParalelo} × {p.generador.modulo.pNom} W ={' '}
                  {((p.generador.nSerie * p.generador.nParalelo * p.generador.modulo.pNom) / 1000).toFixed(2)} kWp
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  {p.clima ? `Clima: ${p.clima.descripcion}` : 'Sin datos climáticos'} · Modificado {new Date(p.modificado).toLocaleString('es-EC')}
                </p>
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                <Boton variante="primario" onClick={() => abrirYIr(p)}>Abrir</Boton>
                <Boton onClick={() => exportar(p)}>Exportar</Boton>
                <Boton onClick={() => duplicar(p)}>Duplicar</Boton>
                <Boton variante="peligro" onClick={() => borrar(p)}>Borrar</Boton>
              </div>
            </Tarjeta>
          ))}
          <Tarjeta>
            <p className="text-sm text-slate-500">¿Quieres ver un caso resuelto?</p>
            <Boton className="mt-2" onClick={crearEjemplo}>Abrir ejemplo Ibarra</Boton>
          </Tarjeta>
        </div>
      )}
    </>
  );
}
