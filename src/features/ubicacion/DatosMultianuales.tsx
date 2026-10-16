/** Series meteorológicas multianuales: descarga por años, variabilidad interanual, P50/P90 y comparación de fuentes. */
import { useMemo, useState } from 'react';
import { Aviso, Boton, CampoNumero, Indicador, Insignia, Rejilla, Segmentado, Tabla, Tarjeta } from '@/components/ui';
import { COLORES, Grafico } from '@/components/Grafico';
import { useProyecto } from '@/proyecto/store';
import { NOMBRE_FUENTE, seriesDeFuente } from '@/proyecto/entrada';
import { descargarAnios } from '@/clima/servicio';
import { analizar, compararMensual, type AnalisisMultianual } from '@/clima/variabilidad';
import { resumenMensual } from '@/clima/resumen';
import { PVGIS_SERIES_ANIO_MAX, PVGIS_SERIES_ANIO_MIN } from '@/clima/lectores';
import { NOMBRES_MES, NOMBRES_MES_LARGO } from '@/engine/calendario';
import type { FuenteSerie } from '@/engine/tipos';
import { fmt, pct } from '@/lib/formato';

const ULTIMO_NASA = new Date().getFullYear() - 1;
const RANGOS: Record<FuenteSerie, { min: number; max: number; desde: number; hasta: number }> = {
  'nasa-power': { min: 2001, max: ULTIMO_NASA, desde: ULTIMO_NASA - 4, hasta: ULTIMO_NASA },
  'pvgis-serie': { min: PVGIS_SERIES_ANIO_MIN, max: PVGIS_SERIES_ANIO_MAX, desde: PVGIS_SERIES_ANIO_MAX - 4, hasta: PVGIS_SERIES_ANIO_MAX },
};
const PALETA_ANIOS = ['#0ea5e9', '#10b981', '#8b5cf6', '#ec4899', '#64748b', '#14b8a6', '#6366f1', '#84cc16', '#e11d48', '#a855f7', '#06b6d4', '#ca8a04'];

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

  const cambiarFuente = (f: FuenteSerie) => {
    setFuente(f);
    setDesde(RANGOS[f].desde);
    setHasta(RANGOS[f].hasta);
    setMensajes([]);
  };

  const series = useMemo(() => seriesDeFuente(p, fuente), [p.seriesAnuales, fuente]); // eslint-disable-line react-hooks/exhaustive-deps
  const lejos = series.some((s) => Math.abs(s.clima.latitud - u.latitud) > 0.05 || Math.abs(s.clima.longitud - u.longitud) > 0.05);
  const analisis = useMemo(() => (series.length ? analizar(series, p.datosSimulacion.incertidumbreDato) : null), [series, p.datosSimulacion.incertidumbreDato]);

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
      ...r.avisos.slice(0, 4).map((t) => ({ tipo: 'aviso' as const, texto: t })),
    ]);
  };

  const quitar = () => {
    if (!confirm(`¿Quitar todos los años de ${NOMBRE_FUENTE[fuente]} de este proyecto? (Siguen en la caché del dispositivo.)`)) return;
    actualizar((x) => ({
      ...x,
      seriesAnuales: x.seriesAnuales.filter((s) => s.fuente !== fuente),
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
          {series.length > 0 && <Boton variante="fantasma" disabled={!!progreso} onClick={() => descargar(true)}>Forzar nueva descarga</Boton>}
          {series.length > 0 && <Boton variante="peligro" disabled={!!progreso} onClick={quitar}>Quitar años</Boton>}
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
        {series.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {series.map((s) => <Insignia key={s.anio} tono={analisis?.peorAnio.anio === s.anio ? 'rojo' : 'azul'}>{s.anio}</Insignia>)}
          </div>
        )}
        {analisis && <Analisis a={analisis} fuente={fuente} onUsar={usar} />}
      </Tarjeta>
      <ComparacionFuentes />
    </>
  );
}

function Analisis({ a, fuente, onUsar }: { a: AnalisisMultianual; fuente: FuenteSerie; onUsar: (modo: 'anio' | 'promedio' | 'todos', anio?: number | null) => void }) {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const g = a.ghi;

  const opcion = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 1)} kWh/m²` },
    legend: { data: [...a.anios.map((x) => String(x.anio)), 'Promedio'] },
    xAxis: { type: 'category', data: NOMBRES_MES, boundaryGap: false },
    yAxis: { type: 'value', name: 'kWh/m²', scale: true },
    series: [
      ...a.anios.map((x, i) => ({
        name: String(x.anio), type: 'line', data: x.ghiMensual.map((v) => +v.toFixed(1)), symbolSize: 4,
        lineStyle: { width: 1.5, opacity: 0.8 }, itemStyle: { color: PALETA_ANIOS[i % PALETA_ANIOS.length] },
      })),
      { name: 'Promedio', type: 'line', data: a.promedioMensual.map((v) => +v.toFixed(1)), lineStyle: { width: 4 }, symbolSize: 7, itemStyle: { color: COLORES.solar }, z: 10 },
    ],
  }), [a]);

  const desv = (v: number) => (g.media > 0 ? v / g.media - 1 : 0);

  return (
    <div className="mt-4 space-y-4">
      <Rejilla>
        <Indicador etiqueta={`GHI anual promedio (${g.n} años)`} valor={fmt(g.media, 0)} unidad="kWh/m²" detalle={`HSP ${fmt(g.media / 365, 2)} h/día`} />
        <Indicador etiqueta="Variabilidad interanual" valor={pct(g.cv, 1)} detalle={`σ = ${fmt(g.desviacion, 1)} kWh/m² · rango ${fmt(g.minimo, 0)}–${fmt(g.maximo, 0)}`} tono={g.cv > 0.05 ? 'aviso' : 'normal'} />
        <Indicador etiqueta="P50 · P90 (1 año)" valor={`${fmt(g.p50, 0)} · ${fmt(g.p90, 0)}`} unidad="kWh/m²" detalle={`P90 a 10 años: ${fmt(g.p90Decenal, 0)} (${pct(g.p90Decenal / g.p50 - 1, 1)})`} />
        <Indicador etiqueta="Peor año · peor mes" valor={`${a.peorAnio.anio} · ${NOMBRES_MES[a.peorMes.mes]} ${a.peorMes.anio}`}
          detalle={`${fmt(a.peorAnio.ghiAnual, 0)} kWh/m² (${pct(desv(a.peorAnio.ghiAnual), 1)}) · ${fmt(a.peorMes.hsp, 2)} h/día`} tono="mal" />
      </Rejilla>
      {g.n < 10 && <Aviso tipo="info">Con {g.n} años, la desviación estándar es una estimación con incertidumbre alta. Para P90 bancables se recomiendan 10 años o más (amplía el rango) y sumar la incertidumbre del dato satelital.</Aviso>}

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3"><Grafico opcion={opcion} alto={320} /></div>
        <div className="space-y-3 lg:col-span-2">
          <CampoNumero etiqueta="Incertidumbre del dato satelital (para P90)" unidad="%" decimales={1} min={0} max={20} valor={p.datosSimulacion.incertidumbreDato * 100}
            onChange={(v) => actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, incertidumbreDato: v / 100 } }))}
            ayuda="0 % = solo variabilidad interanual. Valores típicos: 3–5 % (SARAH), 5–8 % (NASA POWER)." />
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
          const iMin = x.hspMensual.indexOf(Math.min(...x.hspMensual));
          return [
            <span key="a" className="font-medium">{x.anio}{x.anio === a.peorAnio.anio && <span className="ml-1"><Insignia tono="rojo">peor</Insignia></span>}{x.anio === a.mejorAnio.anio && <span className="ml-1"><Insignia tono="verde">mejor</Insignia></span>}</span>,
            fmt(x.ghiAnual, 0),
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

      <details className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <summary className="cursor-pointer text-sm font-medium">Tabla mensual por año (GHI kWh/m²)</summary>
        <div className="mt-3">
          <Tabla
            cabeceras={['Mes', ...a.anios.map((x) => String(x.anio)), 'Promedio', 'σ', 'CV']}
            filas={NOMBRES_MES.map((m, i) => [
              m, ...a.anios.map((x) => {
                const peor = x.anio === a.peorMes.anio && i === a.peorMes.mes;
                return <span key={x.anio} className={peor ? 'rounded bg-red-100 px-1 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300' : ''}>{fmt(x.ghiMensual[i], 1)}</span>;
              }),
              <b key="p">{fmt(a.promedioMensual[i], 1)}</b>, fmt(a.desviacionMensual[i], 1), pct(a.promedioMensual[i] > 0 ? a.desviacionMensual[i] / a.promedioMensual[i] : 0, 1),
            ])}
            pie={['Año', ...a.anios.map((x) => fmt(x.ghiAnual, 0)), fmt(g.media, 0), fmt(g.desviacion, 1), pct(g.cv, 1)]}
          />
          <p className="mt-2 text-xs text-slate-500">En rojo: el peor mes de toda la serie ({NOMBRES_MES_LARGO[a.peorMes.mes]} {a.peorMes.anio}, {fmt(a.peorMes.hsp, 2)} h/día) — referencia para dimensionar sistemas aislados.</p>
        </div>
      </details>
      <p className="text-xs text-slate-500">Fuente del análisis: {NOMBRE_FUENTE[fuente]}. P50/P90 con distribución normal (ver MODELOS.md §18).</p>
    </div>
  );
}

/** Compara mes a mes el clima principal (p. ej. PVGIS TMY) con el promedio multianual de NASA y de PVGIS. */
function ComparacionFuentes() {
  const p = useProyecto((s) => s.proyecto)!;
  const datos = useMemo(() => {
    const columnas: { nombre: string; mensual: number[] }[] = [];
    if (p.clima) columnas.push({ nombre: p.clima.fuente === 'pvgis-tmy' ? 'PVGIS TMY' : `Principal (${p.clima.fuente})`, mensual: resumenMensual(p.clima).meses.map((m) => m.ghi) });
    for (const f of ['nasa-power', 'pvgis-serie'] as FuenteSerie[]) {
      const s = seriesDeFuente(p, f);
      if (s.length) {
        const a = analizar(s);
        columnas.push({ nombre: `${f === 'nasa-power' ? 'NASA' : 'PVGIS series'} promedio ${a.anios[0].anio}–${a.anios[a.anios.length - 1].anio}`, mensual: a.promedioMensual });
      }
    }
    return columnas;
  }, [p.clima, p.seriesAnuales]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = datos[0];
  const otros = datos.slice(1);
  const comparaciones = useMemo(() => (base ? otros.map((o) => ({ nombre: o.nombre, ...compararMensual(base.mensual, o.mensual) })) : []), [base, otros]);

  const opcion = useMemo(() => base && comparaciones.length ? ({
    tooltip: { trigger: 'axis' },
    legend: { data: [base.nombre, ...otros.map((o) => o.nombre), ...comparaciones.map((c) => `Dif. ${c.nombre.split(' ')[0]} %`)] },
    grid: { left: 44, right: 44 },
    xAxis: { type: 'category', data: NOMBRES_MES },
    yAxis: [{ type: 'value', name: 'kWh/m²' }, { type: 'value', name: '%', splitLine: { show: false } }],
    series: [
      { name: base.nombre, type: 'bar', data: base.mensual.map((v) => +v.toFixed(1)), itemStyle: { color: COLORES.solar, borderRadius: [3, 3, 0, 0] } },
      ...otros.map((o, i) => ({ name: o.nombre, type: 'bar', data: o.mensual.map((v) => +v.toFixed(1)), itemStyle: { color: [COLORES.azul, COLORES.violeta][i], borderRadius: [3, 3, 0, 0] } })),
      ...comparaciones.map((c, i) => ({ name: `Dif. ${c.nombre.split(' ')[0]} %`, type: 'line', yAxisIndex: 1, data: c.filas.map((f) => +(f.diferencia * 100).toFixed(1)), itemStyle: { color: [COLORES.rojo, COLORES.rosa][i] } })),
    ],
  }) : null, [base, otros, comparaciones]);

  if (datos.length < 2) {
    return (
      <Tarjeta className="mt-4" titulo="Comparación de fuentes">
        <p className="text-sm text-slate-500">Descarga el TMY de PVGIS (datos principales) y los años de NASA POWER para comparar las fuentes mes a mes.</p>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta className="mt-4" titulo="Comparación de fuentes" subtitulo={`Irradiación global horizontal mensual. Diferencia = (otra fuente − ${base.nombre}) / ${base.nombre}.`}>
      {opcion && <Grafico opcion={opcion} alto={300} />}
      <div className="mt-3">
        <Tabla
          cabeceras={['Mes', base.nombre, ...comparaciones.flatMap((c) => [c.nombre, 'Dif.'])]}
          filas={NOMBRES_MES.map((m, i) => [m, fmt(base.mensual[i], 1), ...comparaciones.flatMap((c) => [fmt(c.filas[i].b, 1), difSpan(c.filas[i].diferencia)])])}
          pie={['Año', fmt(comparaciones[0]?.anualA ?? 0, 0), ...comparaciones.flatMap((c) => [fmt(c.anualB, 0), difSpan(c.diferenciaAnual)])]}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">Diferencias de 5–10 % entre fuentes satelitales son habituales en zonas andinas por la nubosidad orográfica y la resolución (NASA ≈ 50 km, PVGIS ≈ 5 km). Si hay mediciones locales, úsalas para elegir la fuente.</p>
    </Tarjeta>
  );
}

const difSpan = (d: number) => (
  <span className={Math.abs(d) > 0.1 ? 'font-semibold text-red-600 dark:text-red-400' : Math.abs(d) > 0.05 ? 'text-amber-600 dark:text-amber-400' : ''}>{d > 0 ? '+' : ''}{pct(d, 1)}</span>
);
