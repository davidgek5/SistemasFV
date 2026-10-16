/** Módulo 1: ubicación, datos meteorológicos y horizonte lejano. */
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Titulo } from '@/components/Layout';
import { Aviso, Boton, CampoNumero, CampoTexto, Insignia, Segmentado, Tabla, Tarjeta } from '@/components/ui';
import { COLORES, Grafico } from '@/components/Grafico';
import { useProyecto } from '@/proyecto/store';
import { climaACsv, leerArchivoClima } from '@/clima/lectores';
import { resumenMensual } from '@/clima/resumen';
import { climaEjemplo, descargarNASA, descargarPVGIS, horizontePVGIS, leerHorizonteTexto } from '@/clima/servicio';
import { NOMBRES_MES } from '@/engine/calendario';
import { descargarArchivo, fmt, nombreArchivo } from '@/lib/formato';
import { alturaHorizonte, prepararPerfil } from '@/engine/horizonte/horizonte';

import { DatosMultianuales } from './DatosMultianuales';

const Mapa = lazy(() => import('./Mapa'));

type Fuente = 'pvgis' | 'nasa' | 'archivo' | 'ejemplo';

export default function PaginaUbicacion() {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const [fuente, setFuente] = useState<Fuente>('pvgis');
  const [anioNasa, setAnioNasa] = useState(new Date().getFullYear() - 2);
  const [cargando, setCargando] = useState(false);
  const [mensajes, setMensajes] = useState<{ tipo: 'info' | 'aviso' | 'error' | 'ok'; texto: string }[]>([]);
  const [original, setOriginal] = useState<{ nombre: string; texto: string } | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const archivoHorizonte = useRef<HTMLInputElement>(null);
  const u = p.ubicacion;

  const setUbic = (cambios: Partial<typeof u>) => actualizar((x) => ({ ...x, ubicacion: { ...x.ubicacion, ...cambios } }));

  const climaLejano = p.clima && (Math.abs(p.clima.latitud - u.latitud) > 0.05 || Math.abs(p.clima.longitud - u.longitud) > 0.05);

  const ejecutar = async (f: () => Promise<void>) => {
    setCargando(true);
    setMensajes([]);
    try {
      await f();
    } catch (e) {
      setMensajes([{ tipo: 'error', texto: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setCargando(false);
    }
  };

  const descargar = (forzar = false) => ejecutar(async () => {
    if (fuente === 'ejemplo') {
      const c = await climaEjemplo();
      actualizar((x) => ({ ...x, clima: c }));
      setMensajes([{ tipo: 'aviso', texto: 'Datos SINTÉTICOS de Ibarra: sirven para probar la app, no para diseñar.' }]);
      return;
    }
    const r = fuente === 'pvgis' ? await descargarPVGIS(u.latitud, u.longitud, forzar) : await descargarNASA(u.latitud, u.longitud, anioNasa, forzar);
    actualizar((x) => ({
      ...x,
      clima: r.clima,
      ubicacion: { ...x.ubicacion, altitud: x.ubicacion.altitud || r.clima.altitud },
    }));
    setOriginal({ nombre: fuente === 'pvgis' ? 'pvgis-tmy' : `nasa-power-${anioNasa}`, texto: r.textoOriginal });
    setMensajes([
      { tipo: 'ok', texto: `${r.clima.descripcion}${r.deCache ? ' (desde la caché del dispositivo)' : ''}.` },
      ...r.avisos.map((t) => ({ tipo: 'aviso' as const, texto: t })),
    ]);
  });

  const cargarArchivo = (f: File) => ejecutar(async () => {
    const texto = await f.text();
    const { clima, avisos } = leerArchivoClima(f.name, texto, { latitud: u.latitud, longitud: u.longitud, altitud: u.altitud });
    actualizar((x) => ({ ...x, clima }));
    setOriginal({ nombre: f.name.replace(/\.[^.]+$/, ''), texto });
    setMensajes([{ tipo: 'ok', texto: `Archivo «${f.name}» cargado: ${clima.descripcion}.` }, ...avisos.map((t) => ({ tipo: 'aviso' as const, texto: t }))]);
  });

  const resumen = useMemo(() => (p.clima ? resumenMensual(p.clima) : null), [p.clima]);

  const opcionClima = useMemo(() => resumen && {
    tooltip: { trigger: 'axis' },
    legend: { data: ['GHI', 'Difusa', 'Temperatura'] },
    grid: { left: 44, right: 44 },
    xAxis: { type: 'category', data: NOMBRES_MES },
    yAxis: [{ type: 'value', name: 'kWh/m²', nameGap: 12 }, { type: 'value', name: '°C', splitLine: { show: false } }],
    series: [
      { name: 'GHI', type: 'bar', data: resumen.meses.map((m) => +m.ghi.toFixed(1)), itemStyle: { color: COLORES.solar, borderRadius: [4, 4, 0, 0] } },
      { name: 'Difusa', type: 'bar', data: resumen.meses.map((m) => +m.dhi.toFixed(1)), itemStyle: { color: COLORES.azul, borderRadius: [4, 4, 0, 0] } },
      { name: 'Temperatura', type: 'line', yAxisIndex: 1, smooth: true, data: resumen.meses.map((m) => +m.tamb.toFixed(1)), itemStyle: { color: COLORES.rojo } },
    ],
  }, [resumen]);

  const perfilH = useMemo(() => prepararPerfil(p.horizonte), [p.horizonte]);
  const opcionHorizonte = useMemo(() => {
    if (perfilH.puntos.length === 0) return null;
    const az = Array.from({ length: 361 }, (_, i) => i - 180);
    return {
      legend: false,
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 1)}°` },
      grid: { left: 40, right: 12, top: 16 },
      xAxis: { type: 'value', min: -180, max: 180, interval: 45, name: 'Azimut (0 = S, −90 = E, +90 = O)', nameLocation: 'middle', nameGap: 24,
        axisLabel: { formatter: (v: number) => ({ '-180': 'N', '-90': 'E', '0': 'S', '90': 'O', '180': 'N' } as Record<string, string>)[String(v)] ?? `${v}°` } },
      yAxis: { type: 'value', min: 0, name: 'Altura °' },
      series: [{ type: 'line', showSymbol: false, areaStyle: { color: 'rgba(100,116,139,0.35)' }, lineStyle: { color: '#64748b' }, data: az.map((a) => [a, +alturaHorizonte(perfilH, a).toFixed(2)]) }],
    };
  }, [perfilH]);

  return (
    <>
      <Titulo titulo="Ubicación y clima" subtitulo="Haz clic en el mapa o escribe las coordenadas. Luego descarga el año meteorológico." />
      <div className="grid gap-4 lg:grid-cols-5">
        <Tarjeta className="lg:col-span-3">
          <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-slate-100 sm:h-96 dark:bg-slate-800" />}>
            <Mapa lat={u.latitud} lon={u.longitud} onElegir={(lat, lon) => setUbic({ latitud: +lat.toFixed(4), longitud: +lon.toFixed(4) })} />
          </Suspense>
        </Tarjeta>
        <Tarjeta titulo="Sitio" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3">
            <CampoTexto etiqueta="Nombre del sitio" valor={u.nombre} onChange={(v) => setUbic({ nombre: v })} ancho="col-span-2" />
            <CampoNumero etiqueta="Latitud" valor={u.latitud} min={-90} max={90} unidad="°" decimales={4} onChange={(v) => setUbic({ latitud: v })} />
            <CampoNumero etiqueta="Longitud" valor={u.longitud} min={-180} max={180} unidad="°" decimales={4} onChange={(v) => setUbic({ longitud: v })} />
            <CampoNumero etiqueta="Altitud" valor={u.altitud} unidad="m" onChange={(v) => setUbic({ altitud: v })} ayuda="Afecta presión y posición solar." />
            <CampoNumero etiqueta="Huso horario" valor={u.husoHorario} unidad="h UTC" min={-12} max={14} onChange={(v) => setUbic({ husoHorario: v })} ayuda="Ecuador continental: −5" />
            <CampoTexto etiqueta="Nombre del proyecto" valor={p.nombre} onChange={(v) => actualizar((x) => ({ ...x, nombre: v }))} ancho="col-span-2" />
            <CampoTexto etiqueta="Cliente" valor={p.cliente} onChange={(v) => actualizar((x) => ({ ...x, cliente: v }))} ancho="col-span-2" />
          </div>
        </Tarjeta>
      </div>

      <Tarjeta className="mt-4" titulo="Datos meteorológicos principales" subtitulo="Año típico (TMY) de 8760 h en hora local. Las descargas se guardan en el dispositivo para usarlas sin internet."
        acciones={p.clima && (
          <>
            <Boton onClick={() => descargarArchivo(`clima-${nombreArchivo(p.nombre)}.csv`, climaACsv(p.clima!), 'text/csv')}>Exportar CSV</Boton>
            {original && <Boton onClick={() => descargarArchivo(`${original.nombre}-original.${original.texto.trimStart().startsWith('{') ? 'json' : 'csv'}`, original.texto)}>Archivo original</Boton>}
          </>
        )}>
        <div className="flex flex-wrap items-end gap-3">
          <Segmentado<Fuente> valor={fuente} onChange={setFuente} opciones={[
            { valor: 'pvgis', texto: 'PVGIS TMY' }, { valor: 'nasa', texto: 'NASA POWER' }, { valor: 'archivo', texto: 'CSV propio' }, { valor: 'ejemplo', texto: 'Ejemplo' },
          ]} />
          {fuente === 'nasa' && <CampoNumero etiqueta="Año" valor={anioNasa} min={2001} max={new Date().getFullYear() - 1} onChange={setAnioNasa} ancho="w-28" />}
          {fuente === 'archivo' ? (
            <Boton variante="primario" disabled={cargando} onClick={() => archivo.current?.click()}>Elegir archivo…</Boton>
          ) : (
            <Boton variante="primario" disabled={cargando} onClick={() => descargar()}>{cargando ? 'Descargando…' : fuente === 'ejemplo' ? 'Cargar ejemplo' : 'Descargar'}</Boton>
          )}
          {fuente !== 'archivo' && fuente !== 'ejemplo' && p.clima && <Boton variante="fantasma" disabled={cargando} onClick={() => descargar(true)}>Forzar nueva descarga</Boton>}
          <input ref={archivo} type="file" accept=".csv,.json,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) cargarArchivo(f); e.target.value = ''; }} />
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {fuente === 'pvgis' && 'PVGIS 5.3 (JRC, Comisión Europea): año meteorológico típico con GHI, DNI, DHI, temperatura y viento. Se descarga sin horizonte; el horizonte se aplica abajo.'}
          {fuente === 'nasa' && 'NASA POWER (comunidad RE): datos horarios de un año real. El año típico construido con datos de NASA llega en la Fase 2.'}
          {fuente === 'archivo' && 'Acepta el TMY de PVGIS (CSV o JSON) y los datos horarios de NASA POWER (CSV o JSON). Si falta DNI/DHI se calculan con Erbs.'}
          {fuente === 'ejemplo' && 'Año sintético reproducible para Ibarra (el mismo del caso de prueba). No usar para diseño.'}
        </p>
        <div className="mt-3 space-y-2">
          {mensajes.map((m, i) => <Aviso key={i} tipo={m.tipo}>{m.texto}</Aviso>)}
          {climaLejano && <Aviso tipo="aviso">Los datos climáticos son de ({fmt(p.clima!.latitud, 2)}, {fmt(p.clima!.longitud, 2)}), lejos de la ubicación actual. Vuelve a descargar.</Aviso>}
          {p.clima?.fuente === 'sintetico' && <Aviso tipo="aviso">Se están usando datos sintéticos de prueba.</Aviso>}
        </div>

        {resumen && opcionClima && (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-2 flex flex-wrap gap-2 text-xs">
                <Insignia tono="ambar">GHI anual {fmt(resumen.anual.ghi, 0)} kWh/m²</Insignia>
                <Insignia tono="ambar">HSP {fmt(resumen.anual.hsp, 2)} h/día</Insignia>
                <Insignia>T media {fmt(resumen.anual.tamb, 1)} °C</Insignia>
                <Insignia tono="azul">T mín {fmt(resumen.anual.tmin, 1)} °C</Insignia>
              </div>
              <Grafico opcion={opcionClima} alto={300} />
            </div>
            <Tabla
              cabeceras={['Mes', 'GHI kWh/m²', 'HSP h/día', 'Difusa kWh/m²', 'T media °C', 'T mín / máx °C', 'Viento m/s']}
              filas={resumen.meses.map((m) => [NOMBRES_MES[m.mes], fmt(m.ghi, 1), fmt(m.hsp, 2), fmt(m.dhi, 1), fmt(m.tamb, 1), `${fmt(m.tmin, 1)} / ${fmt(m.tmax, 1)}`, fmt(m.viento, 1)])}
              pie={['Año', fmt(resumen.anual.ghi, 0), fmt(resumen.anual.hsp, 2), fmt(resumen.anual.dhi, 0), fmt(resumen.anual.tamb, 1), `${fmt(resumen.anual.tmin, 1)} / ${fmt(resumen.anual.tmax, 1)}`, fmt(resumen.anual.viento, 1)]}
            />
          </div>
        )}
      </Tarjeta>

      <DatosMultianuales />

      <Tarjeta className="mt-4" titulo="Horizonte lejano" subtitulo="Montañas que tapan el sol al amanecer o al atardecer. Importante en la Sierra."
        acciones={
          <>
            <Boton disabled={cargando} onClick={() => ejecutar(async () => {
              const puntos = await horizontePVGIS(u.latitud, u.longitud);
              actualizar((x) => ({ ...x, horizonte: { origen: 'pvgis', puntos } }));
              setMensajes([{ tipo: 'ok', texto: `Horizonte de PVGIS cargado (${puntos.length} puntos).` }]);
            })}>Descargar de PVGIS</Boton>
            <Boton onClick={() => archivoHorizonte.current?.click()}>Cargar archivo</Boton>
            {p.horizonte.puntos.length > 0 && <Boton variante="fantasma" onClick={() => actualizar((x) => ({ ...x, horizonte: { origen: 'ninguno', puntos: [] } }))}>Quitar</Boton>}
          </>
        }>
        <input ref={archivoHorizonte} type="file" accept=".csv,.txt,.hor" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const puntos = leerHorizonteTexto(await f.text());
            actualizar((x) => ({ ...x, horizonte: { origen: 'usuario', puntos } }));
            setMensajes([{ tipo: 'ok', texto: `Horizonte propio cargado (${puntos.length} puntos).` }]);
          } catch (err) {
            setMensajes([{ tipo: 'error', texto: err instanceof Error ? err.message : String(err) }]);
          }
        }} />
        {opcionHorizonte ? (
          <>
            <Insignia tono="azul">{p.horizonte.origen === 'pvgis' ? 'Perfil de PVGIS' : 'Perfil propio'}</Insignia>
            <Grafico opcion={opcionHorizonte} alto={220} />
          </>
        ) : (
          <p className="text-sm text-slate-500">Sin horizonte (se supone despejado). El archivo propio debe tener filas «azimut, altura» en grados, con azimut 0 = sur, −90 = este, +90 = oeste (convención PVsyst).</p>
        )}
      </Tarjeta>
    </>
  );
}
