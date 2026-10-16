/** Elige con qué datos meteorológicos se simula: principal (TMY), un año, el promedio o todos los años. */
import { useProyecto } from '@/proyecto/store';
import { fuentesDisponibles, NOMBRE_FUENTE, seriesDeFuente } from '@/proyecto/entrada';
import type { ModoDatosSimulacion } from '@/proyecto/esquema';
import type { FuenteSerie } from '@/engine/tipos';
import { Aviso, Selector } from './ui';

export function SelectorDatosSimulacion() {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const d = p.datosSimulacion;
  const fuentes = fuentesDisponibles(p);
  const fuente = fuentes.includes(d.fuente) ? d.fuente : (fuentes[0] ?? d.fuente);
  const anios = seriesDeFuente(p, fuente).map((s) => s.anio);
  const set = (c: Partial<typeof d>) => actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, ...c } }));

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector<ModoDatosSimulacion> etiqueta="Datos para simular" valor={d.modo} onChange={(modo) => set({ modo, fuente, anio: modo === 'anio' ? (d.anio && anios.includes(d.anio) ? d.anio : anios[anios.length - 1] ?? null) : d.anio })}
          opciones={[
            { valor: 'principal', texto: p.clima ? `Principal: ${p.clima.fuente === 'pvgis-tmy' ? 'PVGIS TMY' : p.clima.descripcion.slice(0, 40)}` : 'Principal (sin datos)' },
            { valor: 'anio', texto: 'Un año concreto', disabled: fuentes.length === 0 },
            { valor: 'promedio', texto: 'Promedio multianual', disabled: fuentes.length === 0 },
            { valor: 'todos', texto: 'Simular todos los años', disabled: fuentes.length === 0 },
          ]} />
        {d.modo !== 'principal' && (
          <Selector<FuenteSerie> etiqueta="Fuente" valor={fuente} onChange={(f) => set({ fuente: f, anio: null })}
            opciones={(['nasa-power', 'pvgis-serie'] as FuenteSerie[]).map((f) => ({ valor: f, texto: `${NOMBRE_FUENTE[f]} (${seriesDeFuente(p, f).length} años)`, disabled: !fuentes.includes(f) }))} />
        )}
        {d.modo === 'anio' && anios.length > 0 && (
          <Selector etiqueta="Año" valor={String(d.anio ?? anios[anios.length - 1])} onChange={(a) => set({ anio: Number(a) })}
            opciones={anios.map((a) => ({ valor: String(a), texto: String(a) }))} />
        )}
      </div>
      {fuentes.length === 0 && <p className="mt-1 text-xs text-slate-500">Para usar años reales, descárgalos en Ubicación → Datos multianuales.</p>}
      {d.modo === 'promedio' && <div className="mt-2"><Aviso tipo="info">El promedio hora a hora suaviza los días muy nublados: la energía anual es representativa, pero en off-grid subestima los déficits. Para off-grid usa «todos los años» o el peor año.</Aviso></div>}
    </div>
  );
}
