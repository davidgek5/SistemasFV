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
    const g = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    grafico.current = g;
    const ro = new ResizeObserver(() => g.resize());
    ro.observe(ref.current);
    return () => {
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
      legend: { textStyle: { color: texto }, top: 0, type: 'scroll' },
      tooltip: { trigger: 'axis', confine: true, backgroundColor: oscuro ? '#0f172a' : '#fff', borderColor: lineas, textStyle: { color: texto } },
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
    grafico.current?.setOption(
      {
        ...base,
        ...o,
        grid: { ...(base.grid as object), ...(o.grid as object) },
        legend: o.legend === false ? { show: false } : { ...(base.legend as object), ...(o.legend as object) },
        tooltip: { ...(base.tooltip as object), ...(o.tooltip as object) },
        ...(o.xAxis ? { xAxis: conEjes(o.xAxis) } : {}),
        ...(o.yAxis ? { yAxis: conEjes(o.yAxis) } : {}),
      },
      true,
    );
  }, [opcion, oscuro]);

  return <div ref={ref} style={{ height: alto }} className="w-full" />;
}
