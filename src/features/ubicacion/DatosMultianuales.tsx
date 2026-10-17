/** Series meteorológicas multianuales: descarga por años, control de calidad, variabilidad, P50/P90 y comparación de fuentes. */
import { useMemo, useState } from 'react';
import { Aviso, Boton, CampoNumero, Indicador, Insignia, Interruptor, Rejilla, Segmentado, Tabla, Tarjeta } from '@/components/ui';
import { COLORES, Grafico } from '@/components/Grafico';
import { useProyecto } from '@/proyecto/store';
import { mesesExcluidos, NOMBRE_FUENTE, seriesDeFuente } from '@/proyecto/entrada';
import { INCERTIDUMBRE_POR_DEFECTO, type Exclusion } from '@/proyecto/esquema';
import { descargarAnios, descargarPVGIS } from '@/clima/servicio';
import { analizar, compararMensual, type AnalisisMultianual } from '@/clima/variabilidad';
import { calidadSeries, type CalidadAnio, type MesAtipico } from '@/clima/calidad';
import { resumenMensual } from '@/clima/resumen';
import { PVGIS_SERIES_ANIO_MAX, PVGIS_SERIES_ANIO_MIN } from '@/clima/lectores';
import { NOMBRES_MES, NOMBRES_MES_LARGO } from '@/engine/calendario';
import type { DatosClima, FuenteSerie } from '@/engine/tipos';
import { fmt, pct } from '@/lib/formato';

const ULTIMO_NASA = new Date().getFullYear() - 1;
const RANGOS: Record<FuenteSerie, { min: number; max: number; desde: number; hasta: number }> = {
  'nasa-power': { min: 2001, max: ULTIMO_NASA, desde: ULTIMO_NASA - 4, hasta: ULTIMO_NASA },
  'pvgis-serie': { min: PVGIS_SERIES_ANIO_MIN, max: PVGIS_SERIES_ANIO_MAX, desde: PVGIS_SERIES_ANIO_MAX - 4, hasta: PVGIS_SERIES_ANIO_MAX },
};
const PALETA_ANIOS = ['#0ea5e9', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#14b8a6', '#6366f1', '#84cc16', '#e11d48', '#a855f7', '#06b6d4', '#ca8a04'];
const NOMBRE_DATO: Record<FuenteSerie, string> = { 'nasa-power': 'NASA POWER', 'pvgis-serie': 'PVGIS-SARAH' };

function useExclusiones(fuente: FuenteSerie) {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const es = (anio: number, mes: number | null) => p.exclusiones.some((e) => e.fuente === fuente && e.anio === anio && e.mes === mes);
  const alternar = (anio: number, mes: number | null) =>
    actualizar((x) => {
      const igual = (e: Exclusion) => e.fuente === fuente && e.anio === anio && e.mes === mes;
      return { ...x, exclusiones: x.exclusiones.some(igual) ? x.exclusiones.filter((e) => !igual(e)) : [...x.exclusiones, { fuente, anio, mes }] };
    });
  return { es, alternar };
}

export function DatosMultianuales() {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const [fuente, setFuente] = useState<FuenteSerie>('nasa-power');
  const [desde, setDesde] = useState(RANGOS['nasa-power'].desde);
  const [hasta, setHasta] = useState(RANGOS['nasa-power'].hasta);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [mensajes, setMensajes] = useState<{ tipo: 'ok' | 'aviso' | 'error'; texto: string }[]>([]);
  const u = p.ubicacion;
  const rango = RANGOS[fuente];
  const { es, alternar } = useExclusiones(fuente);

  const cambiarFuente = (f: FuenteSerie) => {
    setFuente(f);
    setDesde(RANGOS[f].desde);
    setHasta(RANGOS[f].hasta);
    setMensajes([]);
  };

  const todas = useMemo(() => seriesDeFuente(p, fuente, true), [p.seriesAnuales, fuente]); // eslint-disable-line react-hooks/exhaustive-deps
  const validas = useMemo(() => seriesDeFuente(p, fuente), [p.seriesAnuales, p.exclusiones, fuente]); // eslint-disable-line react-hooks/exhaustive-deps
  const excluidosMes = useMemo(() => mesesExcluidos(p, fuente), [p.exclusiones, fuente]); // eslint-disable-line react-hooks/exhaustive-deps
  const incertidumbre = p.datosSimulacion.incertidumbre[fuente];
  const calidad = useMemo(() => (todas.length ? calidadSeries(todas) : null), [todas]);
  const lejos = todas.some((s) => Math.abs(s.clima.latitud - u.latitud) > 0.05 || Math.abs(s.clima.longitud - u.longitud) > 0.05);
  const analisis = useMemo(() => (validas.length ? analizar(validas, incertidumbre, excluidosMes) : null), [validas, incertidumbre, excluidosMes]);

  const descargar = async (forzar = false) => {
    if (desde > hasta) return setMensajes([{ tipo: 'error', texto: 'El año inicial debe ser menor o igual al final.' }]);
    setMensajes([]);
    setProgreso(`Preparando ${hasta - desde + 1} años…`);
    const r = await descargarAnios(fuente, u.latitud, u.longitud, desde, hasta,
      (hechos, total, anio, deCache) => setProgreso(`${NOMBRE_FUENTE[fuente]} ${anio}${deCache ? ' (caché)' : ''} — ${hechos}/${total}`), forzar);
    setProgreso(null);
    if (r.series.length) {
      const nuevos = new Set(r.series.map((s) => s.anio));
      actualizar((x) => ({
        ...x,
        seriesAnuales: [...x.seriesAnuales.filter((s) => !(s.fuente === fuente && nuevos.has(s.anio))), ...r.series].sort((a, b) => a.anio - b.anio),
      }));
    }
    setMensajes([
      ...(r.series.length ? [{ tipo: 'ok' as const, texto: `${r.series.length} año(s) de ${NOMBRE_FUENTE[fuente]} listos: ${r.series.map((s) => s.anio).join(', ')}.` }] : []),
      ...r.errores.map((t) => ({ tipo: 'error' as const, texto: t })),
      ...r.avisos.filter((a) => !/valores faltantes/.test(a)).slice(0, 4).map((t) => ({ tipo: 'aviso' as const, texto: t })),
    ]);
  };

  const quitar = () => {
    if (!confirm(`¿Quitar todos los años de ${NOMBRE_FUENTE[fuente]} de este proyecto? (Siguen en la caché del dispositivo.)`)) return;
    actualizar((x) => ({
      ...x,
      seriesAnuales: x.seriesAnuales.filter((s) => s.fuente !== fuente),
      exclusiones: x.exclusiones.filter((e) => e.fuente !== fuente),
      datosSimulacion: x.datosSimulacion.fuente === fuente && x.datosSimulacion.modo !== 'principal' ? { ...x.datosSimulacion, modo: 'principal' } : x.datosSimulacion,
    }));
  };

  const usar = (modo: 'anio' | 'promedio' | 'todos', anio: number | null = null) =>
    actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, modo, fuente, anio } }));

  return (
    <>
      <Tarjeta className="mt-4" titulo="Datos multianuales" subtitulo="Años reales para analizar la variabilidad interanual, estimar P50/P90 y diseñar con el peor año o el peor mes.">
        <div className="flex flex-wrap items-end gap-3">
          <Segmentado<FuenteSerie> valor={fuente} onChange={cambiarFuente} opciones={[
            { valor: 'nasa-power', texto: `NASA POWER (2001–${ULTIMO_NASA})` },
            { valor: 'pvgis-serie', texto: `PVGIS series (${PVGIS_SERIES_ANIO_MIN}–${PVGIS_SERIES_ANIO_MAX})` },
          ]} />
          <CampoNumero etiqueta="Desde" valor={desde} min={rango.min} max={rango.max} onChange={(v) => setDesde(Math.round(v))} ancho="w-24" />
          <CampoNumero etiqueta="Hasta" valor={hasta} min={rango.min} max={rango.max} onChange={(v) => setHasta(Math.round(v))} ancho="w-24" />
          <Boton variante="primario" disabled={!!progreso} onClick={() => descargar()}>{progreso ? 'Descargando…' : `Descargar ${Math.max(0, hasta - desde + 1)} años`}</Boton>
          {todas.length > 0 && <Boton variante="fantasma" disabled={!!progreso} onClick={() => descargar(true)}>Forzar nueva descarga</Boton>}
          {todas.length > 0 && <Boton variante="peligro" disabled={!!progreso} onClick={quitar}>Quitar años</Boton>}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {fuente === 'nasa-power'
            ? 'NASA POWER (comunidad RE): datos horarios de satélite y reanálisis, resolución ≈ 0.5°. Cada año se descarga y guarda en caché por separado.'
            : 'PVGIS 5.3 seriescalc (PVGIS-SARAH3): irradiancia horaria real por año sobre el plano horizontal, resolución ≈ 5 km. Cada año se cachea por separado.'}
        </p>
        <div className="mt-3 space-y-2">
          {progreso && <Aviso tipo="info">{progreso}</Aviso>}
          {mensajes.map((m, i) => <Aviso key={i} tipo={m.tipo}>{m.texto}</Aviso>)}
          {lejos && <Aviso tipo="aviso">Algunos años son de otra ubicación. Vuelve a descargarlos para el sitio actual.</Aviso>}
        </div>
        {todas.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {todas.map((s) => (
              <button key={s.anio} onClick={() => alternar(s.anio, null)} title={es(s.anio, null) ? 'Excluido: toca para incluirlo' : 'Toca para excluir este año'}>
                <Insignia tono={es(s.anio, null) ? 'gris' : analisis?.peorAnio.anio === s.anio ? 'rojo' : 'azul'}>
                  <span className={es(s.anio, null) ? 'line-through' : ''}>{s.anio}</span>
                </Insignia>
              </button>
            ))}
          </div>
        )}
        {calidad && <ControlCalidad anios={calidad.anios} atipicos={calidad.atipicos} fuente={fuente} />}
        {analisis && (
          <Analisis a={analisis} fuente={fuente} onUsar={usar} incertidumbre={incertidumbre}
            onIncertidumbre={(v) => actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, incertidumbre: { ...x.datosSimulacion.incertidumbre, [fuente]: v } } }))} />
        )}
        {todas.length > 0 && !analisis && <div className="mt-3"><Aviso tipo="aviso">Todos los años están excluidos. Toca un año para volver a incluirlo.</Aviso></div>}
      </Tarjeta>
      <ComparacionFuentes />
    </>
  );
}

function ControlCalidad({ anios, atipicos, fuente }: { anios: CalidadAnio[]; atipicos: MesAtipico[]; fuente: FuenteSerie }) {
  const { es, alternar } = useExclusiones(fuente);
  const problemas = anios.filter((a) => a.estado !== 'ok');
  const tono = { ok: 'verde', aviso: 'ambar', error: 'rojo' } as const;
  return (
    <details className="mt-4 rounded-xl border border-slate-200 p-3 dark:border-slate-800" open={atipicos.length > 0 || anios.some((a) => a.estado === 'error')}>
      <summary className="cursor-pointer text-sm font-medium">
        Control de calidad · {problemas.length === 0 && atipicos.length === 0 ? 'sin observaciones' : `${atipicos.length} mes(es) atípico(s), ${problemas.length} año(s) con observaciones`}
      </summary>
      <div className="mt-3 space-y-2">
        {atipicos.map((m) => (
          <Aviso key={`${m.anio}-${m.mes}`} tipo={Math.abs(m.z) > 3 ? 'error' : 'aviso'}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <b>{NOMBRES_MES_LARGO[m.mes]} {m.anio}</b>: {fmt(m.valor, 1)} kWh/m², {m.diferencia > 0 ? '+' : ''}{pct(m.diferencia, 1)} respecto a la media de los otros años ({fmt(m.mediaOtros, 1)}), z = {fmt(m.z, 1)}.
                {anios.find((a) => a.anio === m.anio)?.preliminar && ' El año puede tener datos preliminares.'}
              </span>
              <Boton variante={es(m.anio, m.mes) ? 'primario' : 'secundario'} onClick={() => alternar(m.anio, m.mes)}>
                {es(m.anio, m.mes) ? 'Excluido · incluir' : 'Excluir este mes'}
              </Boton>
            </div>
          </Aviso>
        ))}
        {anios.filter((a) => a.preliminar).map((a) => (
          <Aviso key={`p${a.anio}`} tipo="info"><b>{a.anio}</b>: {a.motivoPreliminar} Conviene volver a descargarlo más adelante («Forzar nueva descarga»).</Aviso>
        ))}
      </div>
      <div className="mt-3">
        <Tabla
          cabeceras={['Año', 'Horas válidas', 'Faltantes', 'Fuera de rango (BSRN)', 'Irradiancia nocturna', 'Meses atípicos', 'Estado', '']}
          alinear={['izq', 'der', 'der', 'der', 'der', 'der', 'izq', 'der']}
          filas={anios.map((a) => {
            const at = atipicos.filter((m) => m.anio === a.anio);
            return [
              <span key="a" className={es(a.anio, null) ? 'line-through opacity-60' : 'font-medium'}>{a.anio}</span>,
              `${fmt(a.horasValidasPct, 2)} %`,
              fmt(a.faltantes, 0),
              a.fueraDeRango.total ? <span key="f" title={`GHI ${a.fueraDeRango.ghi} · DHI ${a.fueraDeRango.dhi} · DNI ${a.fueraDeRango.dni} · T ${a.fueraDeRango.tamb} · viento ${a.fueraDeRango.viento}`}>{fmt(a.fueraDeRango.total, 0)} h</span> : '0',
              a.nocturnas ? <span key="n" className="font-semibold text-red-600 dark:text-red-400">{a.nocturnas} h</span> : '0',
              at.length ? at.map((m) => NOMBRES_MES[m.mes]).join(', ') : '—',
              <span key="e" className="flex gap-1"><Insignia tono={tono[a.estado]}>{a.estado === 'ok' ? 'Correcto' : a.estado === 'aviso' ? 'Revisar' : 'Problema'}</Insignia>{a.preliminar && <Insignia tono="azul">preliminar</Insignia>}</span>,
              <Boton key="x" variante="fantasma" onClick={() => alternar(a.anio, null)}>{es(a.anio, null) ? 'Incluir' : 'Excluir año'}</Boton>,
            ];
          })}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Límites físicos BSRN para GHI, DHI y DNI; la irradiancia con el sol bajo el horizonte indica un desfase horario. Un mes es atípico si se aparta más de 2σ de la media de los <b>otros</b> años. Los meses y años excluidos no cuentan en promedios, P50/P90 ni peor mes (MODELOS.md §19).
      </p>
    </details>
  );
}

function Analisis({ a, fuente, onUsar, incertidumbre, onIncertidumbre }: {
  a: AnalisisMultianual; fuente: FuenteSerie; onUsar: (modo: 'anio' | 'promedio' | 'todos', anio?: number | null) => void;
  incertidumbre: number; onIncertidumbre: (v: number) => void;
}) {
  const p = useProyecto((s) => s.proyecto)!;
  const { es, alternar } = useExclusiones(fuente);
  const g = a.ghi;

  const opcion = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 1)} kWh/m²` },
    legend: { data: [...a.anios.map((x) => String(x.anio)), 'Promedio'] },
    xAxis: { type: 'category', data: NOMBRES_MES, boundaryGap: false },
    yAxis: { type: 'value', name: 'kWh/m²', scale: true },
    series: [
      ...a.anios.map((x, i) => ({
        name: String(x.anio), type: 'line', symbolSize: 4,
        data: x.ghiMensual.map((v, m) => (x.mesesExcluidos.includes(m) ? { value: +v.toFixed(1), itemStyle: { color: '#94a3b8', borderType: 'dashed' }, symbol: 'emptyCircle', symbolSize: 9 } : +v.toFixed(1))),
        lineStyle: { width: 1.5, opacity: 0.8 }, itemStyle: { color: PALETA_ANIOS[i % PALETA_ANIOS.length] },
      })),
      { name: 'Promedio', type: 'line', data: a.promedioMensual.map((v) => +v.toFixed(1)), lineStyle: { width: 4 }, symbolSize: 7, itemStyle: { color: COLORES.solar }, z: 10 },
    ],
  }), [a]);

  const desv = (v: number) => (g.media > 0 ? v / g.media - 1 : 0);
  const nExcl = a.anios.reduce((s, x) => s + x.mesesExcluidos.length, 0);

  return (
    <div className="mt-4 space-y-4">
      <Rejilla>
        <Indicador etiqueta={`GHI anual promedio (${g.n} años)`} valor={fmt(g.media, 0)} unidad="kWh/m²" detalle={`HSP ${fmt(g.media / 365, 2)} h/día${nExcl ? ` · ${nExcl} mes(es) excluido(s)` : ''}`} />
        <Indicador etiqueta="Variabilidad interanual" valor={pct(g.cv, 1)} detalle={`σ = ${fmt(g.desviacion, 1)} kWh/m² · rango ${fmt(g.minimo, 0)}–${fmt(g.maximo, 0)}`} tono={g.cv > 0.05 ? 'aviso' : 'normal'} />
        <Indicador etiqueta="P50 · P90 (1 año)" valor={`${fmt(g.p50, 0)} · ${fmt(g.p90, 0)}`} unidad="kWh/m²"
          detalle={`P90 incluye ±${pct(incertidumbre, 0)} del dato · P90 10 años ${fmt(g.p90Decenal, 0)}`} />
        <Indicador etiqueta="Peor año · peor mes" valor={`${a.peorAnio.anio} · ${NOMBRES_MES[a.peorMes.mes]} ${a.peorMes.anio}`}
          detalle={`${fmt(a.peorAnio.ghiAnual, 0)} kWh/m² (${pct(desv(a.peorAnio.ghiAnual), 1)}) · ${fmt(a.peorMes.hsp, 2)} h/día`} tono="mal" />
      </Rejilla>
      <Aviso tipo="info">
        <b>Cómo se calcula el P90:</b> combina la variabilidad interanual (σ = {pct(g.cv, 1)}) con la incertidumbre del dato satelital de {NOMBRE_DATO[fuente]} ({pct(incertidumbre, 1)}):
        σ<sub>total</sub> = √(σ² + (u·μ)²) = {pct(g.sigmaTotal / g.media, 1)} → P90 = P50 − 1.28·σ<sub>total</sub> = {pct(g.p90 / g.p50 - 1, 1)}.
        {g.n < 10 && ` Con ${g.n} años la σ es una estimación poco precisa; para un P90 bancable usa 10 años o más.`}
      </Aviso>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><Grafico opcion={opcion} alto={320} /></div>
        <div className="space-y-3 lg:col-span-2">
          <CampoNumero etiqueta={`Incertidumbre del dato ${NOMBRE_DATO[fuente]} (incluida en el P90)`} unidad="%" decimales={1} min={0} max={20} valor={incertidumbre * 100}
            onChange={(v) => onIncertidumbre(v / 100)}
            ayuda={`Por defecto ${pct(INCERTIDUMBRE_POR_DEFECTO[fuente], 0)} para ${NOMBRE_DATO[fuente]} (NASA POWER 5 %, PVGIS-SARAH 4 %). 0 % = solo variabilidad interanual.`} />
          <div className="rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
            <div className="font-medium">Usar estos datos para simular</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Boton onClick={() => onUsar('promedio')}>Promedio multianual</Boton>
              <Boton onClick={() => onUsar('todos')}>Simular todos los años</Boton>
              <Boton onClick={() => onUsar('anio', a.peorAnio.anio)}>Peor año ({a.peorAnio.anio})</Boton>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Ahora: {p.datosSimulacion.modo === 'principal' ? 'datos principales' : `${NOMBRE_FUENTE[p.datosSimulacion.fuente]} — ${p.datosSimulacion.modo === 'anio' ? `año ${p.datosSimulacion.anio}` : p.datosSimulacion.modo === 'promedio' ? 'promedio' : 'todos los años'}`}
              {p.datosSimulacion.modo !== 'principal' && p.datosSimulacion.fuente !== fuente && ' (otra fuente)'}
            </p>
          </div>
        </div>
      </div>

      <Tabla
        cabeceras={['Año', 'GHI kWh/m²', 'vs. promedio', 'HSP h/día', 'Mes crítico', 'T media °C', 'T mín °C', 'T máx °C', '']}
        alinear={['izq', 'der', 'der', 'der', 'der', 'der', 'der', 'der', 'der']}
        filas={a.anios.map((x) => {
          const hspV = x.hspMensual.map((h, m) => (x.mesesExcluidos.includes(m) ? Infinity : h));
          const iMin = hspV.indexOf(Math.min(...hspV));
          return [
            <span key="a" className="font-medium">{x.anio}{x.anio === a.peorAnio.anio && <span className="ml-1"><Insignia tono="rojo">peor</Insignia></span>}{x.anio === a.mejorAnio.anio && <span className="ml-1"><Insignia tono="verde">mejor</Insignia></span>}</span>,
            <span key="g">{fmt(x.ghiAnual, 0)}{x.mesesExcluidos.length > 0 && <span className="text-xs text-slate-400" title="Con meses excluidos reemplazados por la media"> *</span>}</span>,
            <span key="d" className={desv(x.ghiAnual) < 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}>{desv(x.ghiAnual) > 0 ? '+' : ''}{pct(desv(x.ghiAnual), 1)}</span>,
            fmt(x.hsp, 2),
            `${NOMBRES_MES[iMin]} ${fmt(x.hspMensual[iMin], 2)}`,
            fmt(x.tMedia, 1), fmt(x.tMin, 1), fmt(x.tMax, 1),
            <Boton key="u" variante="fantasma" onClick={() => onUsar('anio', x.anio)}>Simular</Boton>,
          ];
        })}
        pie={['Promedio', fmt(g.media, 0), `σ ${pct(g.cv, 1)}`, fmt(g.media / 365, 2), `${NOMBRES_MES[a.peorMesPromedio.mes]} ${fmt(a.peorMesPromedio.hsp, 2)}`,
          fmt(a.anios.reduce((s, x) => s + x.tMedia, 0) / a.anios.length, 1), fmt(Math.min(...a.anios.map((x) => x.tMin)), 1), fmt(Math.max(...a.anios.map((x) => x.tMax)), 1), '']}
      />
      {nExcl > 0 && <p className="text-xs text-slate-500">* GHI anual con los meses excluidos reemplazados por la media de los demás años.</p>}

      <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <summary className="cursor-pointer text-sm font-medium">Tabla mensual por año (GHI kWh/m²) · toca un valor para excluir o incluir ese mes</summary>
        <div className="mt-3">
          <Tabla
            cabeceras={['Mes', ...a.anios.map((x) => String(x.anio)), 'Promedio', 'σ', 'CV']}
            filas={NOMBRES_MES.map((m, i) => [
              m, ...a.anios.map((x) => {
                const excl = es(x.anio, i);
                const peor = x.anio === a.peorMes.anio && i === a.peorMes.mes;
                return (
                  <button key={x.anio} onClick={() => alternar(x.anio, i)} title={excl ? 'Excluido: toca para incluir' : 'Toca para excluir este mes'}
                    className={excl ? 'rounded px-1 text-slate-400 line-through' : peor ? 'rounded bg-red-100 px-1 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300' : 'rounded px-1 hover:bg-slate-100 dark:hover:bg-slate-800'}>
                    {fmt(x.ghiMensual[i], 1)}
                  </button>
                );
              }),
              <b key="p">{fmt(a.promedioMensual[i], 1)}</b>, fmt(a.desviacionMensual[i], 1), pct(a.promedioMensual[i] > 0 ? a.desviacionMensual[i] / a.promedioMensual[i] : 0, 1),
            ])}
            pie={['Año', ...a.anios.map((x) => fmt(x.ghiAnual, 0)), fmt(g.media, 0), fmt(g.desviacion, 1), pct(g.cv, 1)]}
          />
          <p className="mt-2 text-xs text-slate-500">En rojo: el peor mes de la serie ({NOMBRES_MES_LARGO[a.peorMes.mes]} {a.peorMes.anio}, {fmt(a.peorMes.hsp, 2)} h/día), referencia para sistemas aislados. Tachado: excluido.</p>
        </div>
      </details>
      <p className="text-xs text-slate-500">Fuente del análisis: {NOMBRE_FUENTE[fuente]}. P50/P90 con distribución normal (MODELOS.md §18).</p>
    </div>
  );
}

/** PVGIS TMY vs. promedio de NASA POWER vs. promedio de las series de PVGIS, mes a mes. */
function ComparacionFuentes() {
  const p = useProyecto((s) => s.proyecto)!;
  const [tmyExtra, setTmyExtra] = useState<DatosClima | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comunes, setComunes] = useState(true);
  const tmy = p.clima?.fuente === 'pvgis-tmy' ? p.clima : tmyExtra;

  const datos = useMemo(() => {
    const nasa = seriesDeFuente(p, 'nasa-power');
    const pvgis = seriesDeFuente(p, 'pvgis-serie');
    const aniosComunes = nasa.map((s) => s.anio).filter((a) => pvgis.some((x) => x.anio === a));
    const usarComunes = comunes && aniosComunes.length > 0;
    const filtrar = (lista: typeof nasa) => (usarComunes ? lista.filter((s) => aniosComunes.includes(s.anio)) : lista);
    const prom = (lista: typeof nasa, f: FuenteSerie) => {
      const l = filtrar(lista);
      if (!l.length) return null;
      const a = analizar(l, 0, mesesExcluidos(p, f).filter((e) => l.some((s) => s.anio === e.anio)));
      return { mensual: a.promedioMensual, rango: `${a.anios[0].anio}–${a.anios[a.anios.length - 1].anio}`, n: a.anios.length };
    };
    return {
      tmy: tmy ? resumenMensual(tmy).meses.map((m) => m.ghi) : null,
      nasa: prom(nasa, 'nasa-power'),
      pvgis: prom(pvgis, 'pvgis-serie'),
      aniosComunes, usarComunes,
    };
  }, [p.seriesAnuales, p.exclusiones, tmy, comunes]); // eslint-disable-line react-hooks/exhaustive-deps

  const cargarTMY = async () => {
    setCargando(true);
    setError(null);
    try {
      setTmyExtra((await descargarPVGIS(p.ubicacion.latitud, p.ubicacion.longitud)).clima);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  const series = [
    datos.tmy && { clave: 'tmy', nombre: 'PVGIS TMY', mensual: datos.tmy, color: COLORES.solar },
    datos.nasa && { clave: 'nasa', nombre: `NASA POWER ${datos.nasa.rango}`, mensual: datos.nasa.mensual, color: COLORES.azul },
    datos.pvgis && { clave: 'pvgis', nombre: `PVGIS series ${datos.pvgis.rango}`, mensual: datos.pvgis.mensual, color: COLORES.violeta },
  ].filter(Boolean) as { clave: string; nombre: string; mensual: number[]; color: string }[];
  const ref = series[0];
  const otras = series.slice(1);
  const comps = ref ? otras.map((o) => ({ ...o, ...compararMensual(ref.mensual, o.mensual) })) : [];

  const opcion = useMemo(() => (ref && comps.length ? {
    tooltip: { trigger: 'axis' },
    legend: { data: [...series.map((s) => s.nombre), ...comps.map((c) => `Dif. ${c.nombre.split(' ').slice(0, 2).join(' ')} %`)] },
    grid: { left: 44, right: 44 },
    xAxis: { type: 'category', data: NOMBRES_MES },
    yAxis: [{ type: 'value', name: 'kWh/m²' }, { type: 'value', name: '%', scale: true, splitLine: { show: false } }],
    series: [
      ...series.map((s) => ({ name: s.nombre, type: 'bar', data: s.mensual.map((v) => +v.toFixed(1)), itemStyle: { color: s.color, borderRadius: [3, 3, 0, 0] } })),
      ...comps.map((c, i) => ({ name: `Dif. ${c.nombre.split(' ').slice(0, 2).join(' ')} %`, type: 'line', yAxisIndex: 1, data: c.filas.map((f) => +(f.diferencia * 100).toFixed(1)), itemStyle: { color: [COLORES.rojo, COLORES.rosa][i] } })),
    ],
  } : null), [series, comps, ref]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Tarjeta className="mt-4" titulo="Comparación de fuentes"
      subtitulo={ref ? `Irradiación global horizontal mensual. Diferencia = (fuente − ${ref.nombre}) / ${ref.nombre}.` : 'PVGIS TMY, promedio de NASA POWER y promedio de las series de PVGIS.'}
      acciones={!tmy && <Boton disabled={cargando} onClick={cargarTMY}>{cargando ? 'Cargando…' : 'Cargar PVGIS TMY para comparar'}</Boton>}>
      {error && <div className="mb-3"><Aviso tipo="error">{error}</Aviso></div>}
      {!tmy && p.clima && <div className="mb-3"><Aviso tipo="info">Los datos principales son «{p.clima.descripcion}». Para comparar se carga aparte el TMY de PVGIS (desde la caché si ya se descargó); los datos principales no cambian.</Aviso></div>}
      {datos.aniosComunes.length > 0 && (
        <div className="mb-3">
          <Interruptor etiqueta={`Promediar solo los años comunes a NASA y PVGIS (${datos.aniosComunes.join(', ')})`} valor={comunes} onChange={setComunes}
            ayuda="Así la comparación entre NASA y las series de PVGIS no depende de qué años se descargaron." />
        </div>
      )}
      {series.length < 2 ? (
        <p className="text-sm text-slate-500">Se necesitan al menos dos fuentes: descarga el TMY de PVGIS y los años de NASA POWER y/o de las series de PVGIS.</p>
      ) : (
        <>
          {opcion && <Grafico opcion={opcion} alto={300} />}
          <div className="mt-3">
            <Tabla
              cabeceras={['Mes', ref.nombre, ...comps.flatMap((c) => [c.nombre, `Dif. vs ${ref.nombre}`]), ...(comps.length === 2 ? ['NASA vs PVGIS series'] : [])]}
              filas={NOMBRES_MES.map((m, i) => [m, fmt(ref.mensual[i], 1), ...comps.flatMap((c) => [fmt(c.filas[i].b, 1), difSpan(c.filas[i].diferencia)]),
                ...(comps.length === 2 ? [difSpan(comps[1].mensual[i] > 0 ? comps[0].mensual[i] / comps[1].mensual[i] - 1 : 0)] : [])])}
              pie={['Año', fmt(comps[0].anualA, 0), ...comps.flatMap((c) => [fmt(c.anualB, 0), difSpan(c.diferenciaAnual)]),
                ...(comps.length === 2 ? [difSpan(comps[1].anualB > 0 ? comps[0].anualB / comps[1].anualB - 1 : 0)] : [])]}
            />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Diferencias de 5–10 % entre fuentes satelitales son habituales en zonas andinas por la nubosidad orográfica y la resolución (NASA ≈ 50 km, PVGIS ≈ 5 km).
            El TMY de PVGIS se construye con meses de 2005–2023, por eso puede diferir del promedio de pocos años. Si hay mediciones locales, úsalas para elegir la fuente.
          </p>
        </>
      )}
    </Tarjeta>
  );
}

const difSpan = (d: number) => (
  <span className={Math.abs(d) > 0.1 ? 'font-semibold text-red-600 dark:text-red-400' : Math.abs(d) > 0.05 ? 'text-amber-600 dark:text-amber-400' : ''}>{d > 0 ? '+' : ''}{pct(d, 1)}</span>
);
