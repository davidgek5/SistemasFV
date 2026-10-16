/** Envoltorio de ECharts (importación modular) con tema claro/oscuro y redimensionado automático. */
import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, HeatmapChart, ScatterChart } from 'echarts/charts';
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, PolarComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, HeatmapChart, ScatterChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, VisualMapComponent, MarkLineComponent, PolarComponent, CanvasRenderer]);

export const COLORES = {
  solar: '#f59e0b',
  azul: '#0ea5e9',
  verde: '#10b981',
  rojo: '#ef4444',
  violeta: '#8b5cf6',
  gris: '#94a3b8',
  rosa: '#ec4899',
};

function usarModoOscuro(): boolean {
  const [oscuro, setOscuro] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const m = window.matchMedia('(prefers-color-scheme: dark)');
    const f = () => setOscuro(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return oscuro;
}

export function Grafico({ opcion, alto = 300 }: { opcion: EChartsCoreOption; alto?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const grafico = useRef<echarts.ECharts | null>(null);
  const oscuro = usarModoOscuro();

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const g = echarts.init(el, undefined, { renderer: 'canvas' });
    grafico.current = g;
    const ro = new ResizeObserver(() => g.resize());
    ro.observe(el);
    // El tooltip y el puntero del eje solo deben verse mientras se pasa el cursor o se toca:
    // se ocultan al salir, al tocar fuera, al desplazar la página y unos segundos después de un toque.
    const ocultar = () => {
      if (g.isDisposed()) return;
      g.dispatchAction({ type: 'hideTip' });
      g.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' });
    };
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    const alTocar = () => { clearTimeout(temporizador); temporizador = setTimeout(ocultar, 2500); };
    const fuera = (e: PointerEvent) => { if (!el.contains(e.target as Node)) ocultar(); };
    g.getZr().on('globalout', ocultar);
    el.addEventListener('pointerleave', ocultar);
    el.addEventListener('touchend', alTocar, { passive: true });
    document.addEventListener('pointerdown', fuera, true);
    window.addEventListener('scroll', ocultar, { passive: true, capture: true });
    window.addEventListener('blur', ocultar);
    return () => {
      clearTimeout(temporizador);
      el.removeEventListener('pointerleave', ocultar);
      el.removeEventListener('touchend', alTocar);
      document.removeEventListener('pointerdown', fuera, true);
      window.removeEventListener('scroll', ocultar, { capture: true });
      window.removeEventListener('blur', ocultar);
      ro.disconnect();
      g.dispose();
      grafico.current = null;
    };
  }, []);

  useEffect(() => {
    const texto = oscuro ? '#cbd5e1' : '#334155';
    const lineas = oscuro ? '#1e293b' : '#e2e8f0';
    const base: EChartsCoreOption = {
      backgroundColor: 'transparent',
      textStyle: { color: texto, fontFamily: 'Inter, system-ui, sans-serif' },
      color: [COLORES.solar, COLORES.azul, COLORES.verde, COLORES.violeta, COLORES.rojo, COLORES.gris],
      grid: { left: 48, right: 16, top: 36, bottom: 32, containLabel: false },
      legend: { textStyle: { color: texto }, top: 0, type: 'plain' },
      tooltip: {
        trigger: 'axis', confine: true, triggerOn: 'mousemove|click', alwaysShowContent: false, enterable: false,
        hideDelay: 100, transitionDuration: 0.1, axisPointer: { type: 'line' },
        backgroundColor: oscuro ? '#0f172a' : '#fff', borderColor: lineas, textStyle: { color: texto },
      },
    };
    const conEjes = (ejes: unknown) =>
      (Array.isArray(ejes) ? ejes : ejes ? [ejes] : []).map((e) => ({
        axisLine: { lineStyle: { color: lineas } },
        splitLine: { lineStyle: { color: lineas } },
        axisLabel: { color: texto },
        nameTextStyle: { color: texto },
        ...(e as object),
      }));
    const o = opcion as Record<string, unknown>;
    const g = grafico.current;
    if (!g) return;
    // Reserva espacio para la leyenda según el ancho (en el celular puede ocupar 2–3 líneas)
    const nombres: string[] = ((o.legend as { data?: string[] } | undefined)?.data
      ?? ((o.series as { name?: string }[] | undefined) ?? []).map((x) => x.name ?? '').filter(Boolean));
    const anchoLeyenda = nombres.reduce((a, n) => a + n.length * 7 + 38, 0);
    const filasLeyenda = o.legend === false || nombres.length === 0 ? 0 : Math.max(1, Math.ceil(anchoLeyenda / Math.max(200, (ref.current?.clientWidth ?? 600) - 20)));
    const ejesY = (Array.isArray(o.yAxis) ? o.yAxis : o.yAxis ? [o.yAxis] : []) as { name?: string }[];
    const conNombre = ejesY.some((e) => !!e.name);
    const topGrid = (filasLeyenda === 0 ? 16 : 14 + filasLeyenda * 22) + (conNombre ? 14 : 0);
    g.dispatchAction({ type: 'hideTip' });
    g.setOption(
      {
        ...base,
        ...o,
        grid: { ...(base.grid as object), ...(o.grid as object), top: Math.max(topGrid, ((o.grid as { top?: number })?.top ?? 0)) },
        legend: o.legend === false ? { show: false } : { ...(base.legend as object), ...(o.legend as object) },
        tooltip: { ...(base.tooltip as object), ...(o.tooltip as object) },
        ...(o.xAxis ? { xAxis: conEjes(o.xAxis) } : {}),
        ...(o.yAxis ? { yAxis: conEjes(o.yAxis) } : {}),
      },
      { notMerge: true },
    );
  }, [opcion, oscuro]);

  return <div ref={ref} style={{ height: alto }} className="w-full" />;
}
