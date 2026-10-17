/** Módulo 7 (Fase 1): resultados de la simulación horaria. */
import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Titulo } from '@/components/Layout';
import { Aviso, Boton, Indicador, Rejilla, Tabla, Tarjeta } from '@/components/ui';
import { COLORES, Grafico } from '@/components/Grafico';
import { useProyecto, useResultadoDesactualizado, type ResumenSimAnio } from '@/proyecto/store';
import { puedeSimular, NOMBRE_FUENTE } from '@/proyecto/entrada';
import { SelectorDatosSimulacion } from '@/components/SelectorDatosSimulacion';
import { excedencia } from '@/clima/variabilidad';
import { MES_DE_HORA, NOMBRES_MES } from '@/engine/calendario';
import type { ResultadoSimulacion } from '@/engine/tipos';
import { descargarArchivo, energia, fmt, nombreArchivo, pct } from '@/lib/formato';

export default function PaginaResultados() {
  const p = useProyecto((s) => s.proyecto)!;
  const r = useProyecto((s) => s.resultado);
  const simulando = useProyecto((s) => s.simulando);
  const error = useProyecto((s) => s.errorSimulacion);
  const simular = useProyecto((s) => s.simular);
  const desactualizado = useResultadoDesactualizado();
  const progreso = useProyecto((s) => s.progreso);
  const etiqueta = useProyecto((s) => s.etiquetaDatos);
  const anuales = useProyecto((s) => s.resultadosAnuales);
  const navegar = useNavigate();
  const listo = puedeSimular(p);

  useEffect(() => {
    if (!r && !simulando && listo && p.datosSimulacion.modo !== 'todos') simular();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Titulo titulo="Resultados" subtitulo={r ? `Simulación horaria de 8760 h · ${r.tipo === 'on-grid' ? 'conectado a la red' : 'aislado'} · ${fmt(r.potenciaPicoKWp, 2)} kWp · datos: ${etiqueta ?? '—'} · ${fmt(r.duracionMs, 0)} ms` : 'Simulación horaria de 8760 h.'}
        acciones={
          <>
            {r && <Boton onClick={() => exportarCSV(r, p.nombre)}>Exportar 8760 h (CSV)</Boton>}
            <Boton variante="primario" disabled={simulando || !listo} onClick={simular}>{simulando ? 'Simulando…' : r ? 'Volver a simular' : 'Simular'}</Boton>
          </>
        } />
      <Tarjeta className="mb-4"><SelectorDatosSimulacion /></Tarjeta>
      {!listo && <div className="mb-3"><Aviso tipo="aviso">Faltan los datos meteorológicos elegidos. <button className="underline" onClick={() => navegar('/ubicacion')}>Ir a Ubicación</button></Aviso></div>}
      {progreso && <div className="mb-3"><Aviso tipo="info">{progreso}</Aviso></div>}
      {error && <div className="mb-3"><Aviso tipo="error">{error}</Aviso></div>}
      {desactualizado && <div className="mb-3"><Aviso tipo="aviso">Cambiaste el proyecto después de esta simulación. Pulsa «Volver a simular».</Aviso></div>}
      {p.clima?.fuente === 'sintetico' && p.datosSimulacion.modo === 'principal' && <div className="mb-3"><Aviso tipo="aviso">Resultados con clima SINTÉTICO de prueba: no usar para diseño.</Aviso></div>}
      {r && anuales && anuales.length > 0 && <AnioAAnio anuales={anuales} tipo={r.tipo} incertidumbre={p.datosSimulacion.incertidumbre[p.datosSimulacion.fuente]} fuente={NOMBRE_FUENTE[p.datosSimulacion.fuente]} />}
      {r && anuales && anuales.length > 0 && <h2 className="mb-3 mt-6 text-lg font-semibold">Detalle del año promedio</h2>}
      {r && <Contenido r={r} />}
    </>
  );
}

function Contenido({ r }: { r: ResultadoSimulacion }) {
  const a = r.anual;
  const onGrid = r.tipo === 'on-grid';

  const opcionMensual = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 0)} kWh` },
    legend: { data: onGrid ? ['Producción', 'Consumo', 'Autoconsumo'] : ['Entregada a la carga', 'Consumo', 'No suministrada', 'No utilizada'] },
    xAxis: { type: 'category', data: NOMBRES_MES },
    yAxis: { type: 'value', name: 'kWh' },
    series: onGrid
      ? [
          { name: 'Producción', type: 'bar', data: r.mensual.map((m) => Math.round(m.eSalida)), itemStyle: { color: COLORES.solar, borderRadius: [4, 4, 0, 0] } },
          { name: 'Consumo', type: 'line', data: r.mensual.map((m) => Math.round(m.carga)), itemStyle: { color: COLORES.azul } },
          { name: 'Autoconsumo', type: 'bar', data: r.mensual.map((m) => Math.round(m.autoconsumo)), itemStyle: { color: COLORES.verde, borderRadius: [4, 4, 0, 0] } },
        ]
      : [
          { name: 'Entregada a la carga', type: 'bar', stack: 'c', data: r.mensual.map((m) => Math.round(m.eSalida)), itemStyle: { color: COLORES.verde } },
          { name: 'No suministrada', type: 'bar', stack: 'c', data: r.mensual.map((m) => Math.round(m.noSuministrada)), itemStyle: { color: COLORES.rojo } },
          { name: 'Consumo', type: 'line', data: r.mensual.map((m) => Math.round(m.carga)), itemStyle: { color: COLORES.azul } },
          { name: 'No utilizada', type: 'line', data: r.mensual.map((m) => Math.round(m.desperdiciada)), itemStyle: { color: COLORES.gris }, lineStyle: { type: 'dashed' } },
        ],
  }), [r, onGrid]);

  // Perfil diario promedio por mes (W) — mapa de calor hora × mes
  const perfilMes = useMemo(() => {
    const suma = Array.from({ length: 12 }, () => new Array(24).fill(0));
    const n = Array.from({ length: 12 }, () => new Array(24).fill(0));
    const sumaC = Array.from({ length: 12 }, () => new Array(24).fill(0));
    for (let i = 0; i < 8760; i++) {
      const m = MES_DE_HORA[i];
      const h = i % 24;
      suma[m][h] += r.horario.pSalida[i];
      sumaC[m][h] += r.horario.carga[i];
      n[m][h]++;
    }
    return { prod: suma.map((f, m) => f.map((x, h) => x / n[m][h])), carga: sumaC.map((f, m) => f.map((x, h) => x / n[m][h])) };
  }, [r]);

  const opcionCalor = useMemo(() => {
    const datos: [number, number, number][] = [];
    perfilMes.prod.forEach((f, m) => f.forEach((v, h) => datos.push([h, m, Math.round(v)])));
    const max = Math.max(...datos.map((d) => d[2]), 1);
    return {
      legend: false,
      tooltip: { trigger: 'item', formatter: (q: { value: [number, number, number] }) => `${NOMBRES_MES[q.value[1]]}, ${q.value[0]}–${q.value[0] + 1} h: ${fmt(q.value[2], 0)} W` },
      grid: { left: 40, right: 12, top: 8, bottom: 56 },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}`), splitArea: { show: false } },
      yAxis: { type: 'category', data: NOMBRES_MES, inverse: true },
      visualMap: { min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, inRange: { color: ['#0f172a', '#1e3a8a', '#0ea5e9', '#fbbf24', '#f59e0b'] }, textStyle: { fontSize: 10 } },
      series: [{ type: 'heatmap', data: datos }],
    };
  }, [perfilMes]);

  const opcionDia = useMemo(() => {
    const prom = (mat: number[][]) => Array.from({ length: 24 }, (_, h) => mat.reduce((s, f) => s + f[h], 0) / 12);
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 0)} W` },
      legend: { data: [onGrid ? 'Producción' : 'Entregada', 'Consumo'] },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}h`) },
      yAxis: { type: 'value', name: 'W' },
      series: [
        { name: onGrid ? 'Producción' : 'Entregada', type: 'line', smooth: true, areaStyle: { opacity: 0.25 }, data: prom(perfilMes.prod).map(Math.round), itemStyle: { color: COLORES.solar } },
        { name: 'Consumo', type: 'line', smooth: true, data: prom(perfilMes.carga).map(Math.round), itemStyle: { color: COLORES.azul } },
      ],
    };
  }, [perfilMes, onGrid]);

  const opcionHistograma = useMemo(() => {
    const pmax = Math.max(...r.horario.pSalida, 1);
    const nb = 20;
    const ancho = pmax / nb;
    const cuenta = new Array(nb).fill(0);
    const energiaBin = new Array(nb).fill(0);
    for (const v of r.horario.pSalida) {
      if (v <= 0) continue;
      const b = Math.min(nb - 1, Math.floor(v / ancho));
      cuenta[b]++;
      energiaBin[b] += v / 1000;
    }
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Energía', 'Horas'] },
      grid: { left: 48, right: 44 },
      xAxis: { type: 'category', data: cuenta.map((_, i) => fmt(((i + 0.5) * ancho) / 1000, 1)), name: 'kW', nameLocation: 'middle', nameGap: 24 },
      yAxis: [{ type: 'value', name: 'kWh' }, { type: 'value', name: 'h', splitLine: { show: false } }],
      series: [
        { name: 'Energía', type: 'bar', data: energiaBin.map((x) => Math.round(x)), itemStyle: { color: COLORES.solar } },
        { name: 'Horas', type: 'line', yAxisIndex: 1, data: cuenta, itemStyle: { color: COLORES.violeta } },
      ],
    };
  }, [r]);

  const opcionSOC = useMemo(() => {
    if (onGrid) return null;
    const min: number[] = [], max: number[] = [], dias: string[] = [];
    for (let d = 0; d < 365; d++) {
      let lo = 1, hi = 0;
      for (let h = 0; h < 24; h++) {
        const s = r.horario.soc[d * 24 + h];
        lo = Math.min(lo, s);
        hi = Math.max(hi, s);
      }
      min.push(+(lo * 100).toFixed(1));
      max.push(+(hi * 100).toFixed(1));
      const f = new Date(Date.UTC(2025, 0, 1 + d));
      dias.push(`${f.getUTCDate()} ${NOMBRES_MES[f.getUTCMonth()]}`);
    }
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 0)} %` },
      legend: { data: ['SOC máximo del día', 'SOC mínimo del día'] },
      grid: { bottom: 56 },
      xAxis: { type: 'category', data: dias, boundaryGap: false },
      yAxis: { type: 'value', min: 0, max: 100, name: '%' },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 6 }],
      series: [
        { name: 'SOC máximo del día', type: 'line', showSymbol: false, data: max, itemStyle: { color: COLORES.verde } },
        { name: 'SOC mínimo del día', type: 'line', showSymbol: false, data: min, itemStyle: { color: COLORES.rojo }, areaStyle: { opacity: 0.1 } },
      ],
    };
  }, [r, onGrid]);

  return (
    <>
      <Rejilla>
        <Indicador etiqueta={onGrid ? 'Producción anual (a la red)' : 'Energía entregada a la carga'} valor={energia(a.eSalida)} detalle={`DC ${energia(a.eDC)}`} />
        <Indicador etiqueta="Rendimiento específico" valor={fmt(a.rendimientoEspecifico, 0)} unidad="kWh/kWp·año" detalle={`${fmt(a.rendimientoEspecifico / 365, 2)} kWh/kWp·día`} />
        <Indicador etiqueta="Performance Ratio (PR)" valor={pct(a.pr)} tono={a.pr > 0.75 ? 'bien' : a.pr > 0.6 ? 'aviso' : 'mal'} detalle={`Irradiación en el plano ${fmt(a.poa, 0)} kWh/m²`} />
        <Indicador etiqueta="Fracción solar" valor={pct(a.fraccionSolar)} detalle={`Consumo ${energia(a.carga)}`} tono={!onGrid && a.fraccionSolar < 0.98 ? 'aviso' : 'normal'} />
        {onGrid ? (
          <>
            <Indicador etiqueta="Autoconsumo" valor={energia(a.autoconsumo)} detalle={`${pct(a.tasaAutoconsumo)} de la producción`} />
            <Indicador etiqueta="Inyectada a la red" valor={energia(a.inyeccion)} />
            <Indicador etiqueta="Comprada a la red" valor={energia(a.compra)} />
            <Indicador etiqueta="Horas con recorte (clipping)" valor={fmt(a.horasRecorte, 0)} unidad="h" detalle={`DC/AC ${fmt(r.potenciaPicoKWp / r.potenciaACkW, 2)}`} />
          </>
        ) : (
          <>
            <Indicador etiqueta="Energía no suministrada" valor={energia(a.noSuministrada)} tono={a.noSuministrada > 0 ? 'mal' : 'bien'} detalle={`${pct(a.carga > 0 ? a.noSuministrada / a.carga : 0, 2)} del consumo`} />
            <Indicador etiqueta="Días con déficit" valor={fmt(a.diasConDeficit, 0)} unidad="días" tono={a.diasConDeficit > 0 ? 'aviso' : 'bien'} />
            <Indicador etiqueta="Ciclos equivalentes" valor={fmt(a.ciclosBateria, 0)} unidad="ciclos/año" detalle={`SOC promedio ${pct(a.socPromedio, 0)}`} />
            <Indicador etiqueta="Energía FV no utilizada" valor={energia(a.desperdiciada)} detalle="Batería llena" />
          </>
        )}
      </Rejilla>

      {r.avisos.length > 0 && <div className="mt-3 space-y-2">{r.avisos.map((t, i) => <Aviso key={i} tipo="aviso">{t}</Aviso>)}</div>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Balance mensual"><Grafico opcion={opcionMensual} alto={300} /></Tarjeta>
        <Tarjeta titulo="Diagrama de pérdidas" subtitulo="Cascada anual al estilo PVsyst"><Cascada r={r} /></Tarjeta>
      </div>

      {opcionSOC && <Tarjeta className="mt-4" titulo="Estado de carga de la batería" subtitulo="Mínimo y máximo de cada día. Desliza para ampliar."><Grafico opcion={opcionSOC} alto={280} /></Tarjeta>}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Perfil diario promedio por mes" subtitulo={onGrid ? 'Potencia AC promedio (W)' : 'Potencia entregada a la carga (W)'}><Grafico opcion={opcionCalor} alto={320} /></Tarjeta>
        <Tarjeta titulo="Producción vs. consumo" subtitulo="Día promedio del año"><Grafico opcion={opcionDia} alto={320} /></Tarjeta>
      </div>

      <Tarjeta className="mt-4" titulo="Distribución de potencia" subtitulo="Energía y horas por intervalo de potencia de salida"><Grafico opcion={opcionHistograma} alto={260} /></Tarjeta>

      <Tarjeta className="mt-4" titulo="Tabla mensual">
        <Tabla
          cabeceras={onGrid
            ? ['Mes', 'GHI kWh/m²', 'Plano kWh/m²', 'Efectiva kWh/m²', 'T amb °C', 'E DC kWh', 'E red kWh', 'Consumo kWh', 'Autoconsumo', 'Inyectada', 'Comprada', 'PR']
            : ['Mes', 'GHI kWh/m²', 'Plano kWh/m²', 'Efectiva kWh/m²', 'T amb °C', 'E DC kWh', 'A la carga', 'Consumo kWh', 'No sumin.', 'No utilizada', 'PR']}
          filas={r.mensual.map((m) => onGrid
            ? [NOMBRES_MES[m.mes], fmt(m.ghi, 1), fmt(m.poa, 1), fmt(m.efectiva, 1), fmt(m.tamb, 1), fmt(m.eDC, 0), fmt(m.eSalida, 0), fmt(m.carga, 0), fmt(m.autoconsumo, 0), fmt(m.inyeccion, 0), fmt(m.compra, 0), fmt(m.pr, 3)]
            : [NOMBRES_MES[m.mes], fmt(m.ghi, 1), fmt(m.poa, 1), fmt(m.efectiva, 1), fmt(m.tamb, 1), fmt(m.eDC, 0), fmt(m.eSalida, 0), fmt(m.carga, 0), fmt(m.noSuministrada, 1), fmt(m.desperdiciada, 0), fmt(m.pr, 3)])}
          pie={onGrid
            ? ['Año', fmt(a.ghi, 0), fmt(a.poa, 0), fmt(r.mensual.reduce((s, m) => s + m.efectiva, 0), 0), fmt(r.mensual.reduce((s, m) => s + m.tamb, 0) / 12, 1), fmt(a.eDC, 0), fmt(a.eSalida, 0), fmt(a.carga, 0), fmt(a.autoconsumo, 0), fmt(a.inyeccion, 0), fmt(a.compra, 0), fmt(a.pr, 3)]
            : ['Año', fmt(a.ghi, 0), fmt(a.poa, 0), fmt(r.mensual.reduce((s, m) => s + m.efectiva, 0), 0), fmt(r.mensual.reduce((s, m) => s + m.tamb, 0) / 12, 1), fmt(a.eDC, 0), fmt(a.eSalida, 0), fmt(a.carga, 0), fmt(a.noSuministrada, 1), fmt(a.desperdiciada, 0), fmt(a.pr, 3)]}
        />
        {a.balanceNeto && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Balance neto (compensación mensual de energía)</h3>
            <Tabla cabeceras={['Mes', 'Comprada kWh', 'Inyectada kWh', 'A facturar kWh', 'Crédito acumulado kWh']}
              filas={a.balanceNeto.map((b, i) => [NOMBRES_MES[b.mes], fmt(r.mensual[i].compra, 0), fmt(r.mensual[i].inyeccion, 0), fmt(b.facturadoKWh, 0), fmt(b.creditoKWh, 0)])}
              pie={['Año', fmt(a.compra, 0), fmt(a.inyeccion, 0), fmt(a.balanceNeto.reduce((s, b) => s + b.facturadoKWh, 0), 0), fmt(a.balanceNeto[11].creditoKWh, 0)]} />
            <p className="mt-2 text-xs text-slate-500">Supuesto: el excedente de un mes se acredita a los meses siguientes del mismo año. Verifica las reglas vigentes de la regulación de generación distribuida (ARCERNNR) y de tu distribuidora.</p>
          </div>
        )}
      </Tarjeta>
    </>
  );
}

function Cascada({ r }: { r: ResultadoSimulacion }) {
  const irr = r.cascada.filter((x) => x.tipo === 'irradiacion');
  const ene = r.cascada.filter((x) => x.tipo === 'energia');
  const Fila = ({ etiqueta, valor, variacion, unidad, base, destacado }: { etiqueta: string; valor: number; variacion: number; unidad: string; base?: boolean; destacado?: boolean }) => (
    <div className={`flex items-center gap-2 py-1 text-sm ${destacado ? 'font-semibold' : ''}`}>
      <span className={`tabular w-16 shrink-0 text-right text-xs ${base ? 'text-slate-400' : variacion < -1e-4 ? 'text-red-600 dark:text-red-400' : variacion > 1e-4 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
        {base ? '' : `${variacion > 0 ? '+' : ''}${fmt(variacion * 100, 2)} %`}
      </span>
      <span className="min-w-0 flex-1 truncate" title={etiqueta}>{etiqueta}</span>
      <span className="tabular shrink-0 text-xs text-slate-500">{fmt(valor, 0)} {unidad}</span>
    </div>
  );
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <div className="pb-2">
        {irr.map((x, i) => <Fila key={x.clave} etiqueta={x.etiqueta} valor={x.valor} variacion={x.variacion} unidad="kWh/m²" base={i === 0} destacado={i === 0 || i === irr.length - 1} />)}
      </div>
      <div className="pt-2">
        {ene.map((x, i) => <Fila key={x.clave} etiqueta={x.etiqueta} valor={x.valor} variacion={x.variacion} unidad="kWh" base={i === 0} destacado={i === 0 || x.clave === 'trasOhmicaDC' || i === ene.length - 1} />)}
      </div>
    </div>
  );
}

function exportarCSV(r: ResultadoSimulacion, nombre: string) {
  const h = r.horario;
  const filas = ['hora,mes,dia,hora_dia,POA_Wm2,G_efectiva_Wm2,T_celda_C,P_DC_W,P_salida_W,Carga_W,Autoconsumo_W,Inyeccion_W,Compra_W,SOC,No_suministrada_W,No_utilizada_W'];
  for (let i = 0; i < 8760; i++) {
    const f = new Date(Date.UTC(2025, 0, 1) + i * 3600e3);
    filas.push([i, f.getUTCMonth() + 1, f.getUTCDate(), f.getUTCHours(), h.poa[i].toFixed(1), h.gEf[i].toFixed(1), h.tCelda[i].toFixed(2), h.pDC[i].toFixed(1), h.pSalida[i].toFixed(1), h.carga[i].toFixed(1), h.autoconsumo[i].toFixed(1), h.inyeccion[i].toFixed(1), h.compra[i].toFixed(1), h.soc[i].toFixed(4), h.noSuministrada[i].toFixed(1), h.desperdiciada[i].toFixed(1)].join(','));
  }
  descargarArchivo(`resultados-${nombreArchivo(nombre)}.csv`, filas.join('\n'), 'text/csv');
}

/** Producción de cada año real simulado, con P50/P90 de energía. */
function AnioAAnio({ anuales, tipo, incertidumbre, fuente }: { anuales: ResumenSimAnio[]; tipo: string; incertidumbre: number; fuente: string }) {
  const onGrid = tipo === 'on-grid';
  const e = excedencia(anuales.map((a) => a.eSalida), incertidumbre);
  const peor = onGrid
    ? anuales.reduce((m, a) => (a.eSalida < m.eSalida ? a : m))
    : anuales.reduce((m, a) => (a.noSuministrada > m.noSuministrada ? a : m));
  const opcion = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 0)} kWh` },
    legend: { data: [onGrid ? 'Producción' : 'Entregada a la carga', ...(onGrid ? [] : ['No suministrada'])] },
    xAxis: { type: 'category', data: anuales.map((a) => String(a.anio)) },
    yAxis: { type: 'value', name: 'kWh', scale: onGrid },
    series: [
      {
        name: onGrid ? 'Producción' : 'Entregada a la carga', type: 'bar', stack: 'e', data: anuales.map((a) => Math.round(a.eSalida)),
        itemStyle: { color: onGrid ? COLORES.solar : COLORES.verde, borderRadius: onGrid ? [4, 4, 0, 0] : 0 },
        markLine: onGrid ? {
          symbol: 'none', label: { formatter: (q: { name: string }) => q.name, position: 'insideEndTop' },
          data: [{ name: `P50 ${fmt(e.p50, 0)}`, yAxis: Math.round(e.p50), lineStyle: { color: COLORES.azul } }, { name: `P90 ${fmt(e.p90, 0)}`, yAxis: Math.round(e.p90), lineStyle: { color: COLORES.rojo, type: 'dashed' } }],
        } : undefined,
      },
      ...(onGrid ? [] : [{ name: 'No suministrada', type: 'bar', stack: 'e', data: anuales.map((a) => Math.round(a.noSuministrada)), itemStyle: { color: COLORES.rojo, borderRadius: [4, 4, 0, 0] } }]),
    ],
  }), [anuales, onGrid, e.p50, e.p90]);
  return (
    <Tarjeta className="mb-4" titulo={`Año a año (${fuente}, ${anuales.length} años)`} subtitulo="Una simulación completa de 8760 h por cada año real.">
      <Rejilla>
        <Indicador etiqueta={onGrid ? 'Producción P50' : 'Energía entregada P50'} valor={energia(e.p50)} detalle={`${fmt(e.p50 / (anuales[0].eSalida / anuales[0].rendimiento), 0)} kWh/kWp`} />
        <Indicador etiqueta="Producción P90 (1 año)" valor={energia(e.p90)} detalle={`${pct(e.p90 / e.p50 - 1, 1)} · P90 10 años ${energia(e.p90Decenal)}`} />
        <Indicador etiqueta="Variabilidad interanual" valor={pct(e.cv, 1)} detalle={`Rango ${energia(e.minimo)} – ${energia(e.maximo)}`} />
        {onGrid
          ? <Indicador etiqueta="Peor año" valor={String(peor.anio)} detalle={`${energia(peor.eSalida)} · PR ${pct(peor.pr)}`} tono="aviso" />
          : <Indicador etiqueta="Peor año (déficit)" valor={String(peor.anio)} detalle={`${energia(peor.noSuministrada)} no suministrada · ${peor.diasConDeficit} días`} tono={peor.noSuministrada > 0 ? 'mal' : 'bien'} />}
      </Rejilla>
      <div className="mt-3"><Grafico opcion={opcion} alto={280} /></div>
      <div className="mt-3">
        <Tabla
          cabeceras={onGrid ? ['Año', 'GHI kWh/m²', 'Plano kWh/m²', 'Producción kWh', 'vs. P50', 'kWh/kWp', 'PR', 'Fracción solar']
            : ['Año', 'GHI kWh/m²', 'Plano kWh/m²', 'A la carga kWh', 'No sumin. kWh', 'Días con déficit', 'Fracción solar', 'Peor mes (déficit)']}
          filas={anuales.map((a) => {
            const d = e.p50 > 0 ? a.eSalida / e.p50 - 1 : 0;
            const iPeor = a.noSumMensual.indexOf(Math.max(...a.noSumMensual));
            return onGrid
              ? [a.anio === peor.anio ? <b key="a">{a.anio}</b> : String(a.anio), fmt(a.ghi, 0), fmt(a.poa, 0), fmt(a.eSalida, 0), `${d > 0 ? '+' : ''}${pct(d, 1)}`, fmt(a.rendimiento, 0), pct(a.pr), pct(a.fraccionSolar)]
              : [a.anio === peor.anio ? <b key="a">{a.anio}</b> : String(a.anio), fmt(a.ghi, 0), fmt(a.poa, 0), fmt(a.eSalida, 0), fmt(a.noSuministrada, 1), fmt(a.diasConDeficit, 0), pct(a.fraccionSolar, 2), a.noSuministrada > 0 ? `${NOMBRES_MES[iPeor]} (${fmt(a.noSumMensual[iPeor], 1)} kWh)` : '—'];
          })}
        />
      </div>
      <p className="mt-2 text-xs text-slate-500">P50/P90 de energía con distribución normal sobre los años simulados{incertidumbre > 0 ? ` más ${pct(incertidumbre, 1)} de incertidumbre del dato` : ''} (MODELOS.md §18).</p>
    </Tarjeta>
  );
}
