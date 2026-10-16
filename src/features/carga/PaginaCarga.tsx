/** Módulo 2: perfil de carga (equipos o consumo de la factura). */
import { useMemo, useState } from 'react';
import { Titulo } from '@/components/Layout';
import { Aviso, Boton, CampoNumero, CampoTexto, Indicador, Rejilla, Segmentado, Selector, Tarjeta } from '@/components/ui';
import { COLORES, Grafico } from '@/components/Grafico';
import { useProyecto } from '@/proyecto/store';
import { cargaDelProyecto } from '@/proyecto/entrada';
import { equiposEjemplo, idEquipo } from '@/proyecto/porDefecto';
import { NOMBRES_MES } from '@/engine/calendario';
import type { EquipoCarga, PerfilTipico } from '@/engine/tipos';
import { fmt, potencia } from '@/lib/formato';

const TIPICOS: Omit<EquipoCarga, 'id'>[] = [
  { nombre: 'Foco LED', potencia: 9, cantidad: 1, horasLaborable: 5, horasFinDeSemana: 5, inicio: 18, fin: 24, factorArranque: 1 },
  { nombre: 'Refrigeradora', potencia: 150, cantidad: 1, horasLaborable: 10, horasFinDeSemana: 10, inicio: 0, fin: 24, factorArranque: 4 },
  { nombre: 'Congelador', potencia: 200, cantidad: 1, horasLaborable: 12, horasFinDeSemana: 12, inicio: 0, fin: 24, factorArranque: 4 },
  { nombre: 'Televisor', potencia: 100, cantidad: 1, horasLaborable: 4, horasFinDeSemana: 6, inicio: 17, fin: 23, factorArranque: 1 },
  { nombre: 'Computador de escritorio', potencia: 200, cantidad: 1, horasLaborable: 8, horasFinDeSemana: 2, inicio: 8, fin: 18, factorArranque: 1 },
  { nombre: 'Ducha eléctrica', potencia: 4500, cantidad: 1, horasLaborable: 0.5, horasFinDeSemana: 0.5, inicio: 6, fin: 8, factorArranque: 1 },
  { nombre: 'Cocina de inducción (2 zonas)', potencia: 3000, cantidad: 1, horasLaborable: 1.5, horasFinDeSemana: 2, inicio: 11, fin: 14, factorArranque: 1 },
  { nombre: 'Lavadora', potencia: 500, cantidad: 1, horasLaborable: 0, horasFinDeSemana: 2, inicio: 9, fin: 13, factorArranque: 3 },
  { nombre: 'Bomba de agua 1 HP', potencia: 750, cantidad: 1, horasLaborable: 1, horasFinDeSemana: 1, inicio: 6, fin: 9, factorArranque: 5 },
  { nombre: 'Aire acondicionado 12 000 BTU', potencia: 1100, cantidad: 1, horasLaborable: 6, horasFinDeSemana: 8, inicio: 12, fin: 22, factorArranque: 3 },
  { nombre: 'Cámaras de seguridad (DVR)', potencia: 40, cantidad: 1, horasLaborable: 24, horasFinDeSemana: 24, inicio: 0, fin: 24, factorArranque: 1 },
  { nombre: 'Motor trifásico 5 HP', potencia: 3730, cantidad: 1, horasLaborable: 4, horasFinDeSemana: 0, inicio: 8, fin: 17, factorArranque: 6 },
];

export default function PaginaCarga() {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const [tipico, setTipico] = useState('0');
  const { estadisticas: e, perfil, serie } = useMemo(() => cargaDelProyecto(p), [p.carga]); // eslint-disable-line react-hooks/exhaustive-deps

  const equipos = p.carga.modo === 'equipos' ? p.carga.equipos : [];
  const setEquipos = (f: (l: EquipoCarga[]) => EquipoCarga[]) =>
    actualizar((x) => (x.carga.modo === 'equipos' ? { ...x, carga: { modo: 'equipos', equipos: f(x.carga.equipos) } } : x));
  const editar = (id: string, cambios: Partial<EquipoCarga>) => setEquipos((l) => l.map((q) => (q.id === id ? { ...q, ...cambios } : q)));

  const cambiarModo = (modo: 'equipos' | 'mensual') => {
    if (modo === p.carga.modo) return;
    if (modo === 'mensual') {
      const kwhMes = Math.round(e.energiaAnual / 12) || 150;
      actualizar((x) => ({ ...x, carga: { modo: 'mensual', consumoMensualKWh: new Array(12).fill(kwhMes), perfil: 'residencial' } }));
    } else actualizar((x) => ({ ...x, carga: { modo: 'equipos', equipos: equiposEjemplo() } }));
  };

  const opcionDia = useMemo(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${fmt(v, 0)} W` },
    legend: { data: ['Laborable', 'Fin de semana'] },
    xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => `${h}h`) },
    yAxis: { type: 'value', name: 'W' },
    series: [
      { name: 'Laborable', type: 'bar', data: perfil.laborable.map((x) => Math.round(x)), itemStyle: { color: COLORES.solar, borderRadius: [3, 3, 0, 0] } },
      { name: 'Fin de semana', type: 'bar', data: perfil.finDeSemana.map((x) => Math.round(x)), itemStyle: { color: COLORES.azul, borderRadius: [3, 3, 0, 0] } },
    ],
  }), [perfil]);

  const mensual = useMemo(() => {
    const dias = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let i = 0;
    return dias.map((d) => {
      let s = 0;
      for (let k = 0; k < d * 24; k++) s += serie[i++];
      return s / 1000;
    });
  }, [serie]);

  return (
    <>
      <Titulo titulo="Perfil de carga" subtitulo="Lista de equipos con su franja horaria, o consumo mensual de la factura." />
      <Rejilla>
        <Indicador etiqueta="Energía diaria promedio" valor={fmt(e.energiaDiariaPromedio / 1000, 2)} unidad="kWh/día"
          detalle={`Laborable ${fmt(e.energiaDiariaLaborable / 1000, 2)} · Fin de semana ${fmt(e.energiaDiariaFinDeSemana / 1000, 2)}`} />
        <Indicador etiqueta="Energía anual" valor={fmt(e.energiaAnual, 0)} unidad="kWh" detalle={`${fmt(e.energiaAnual / 12, 0)} kWh/mes promedio`} />
        <Indicador etiqueta="Potencia pico simultánea" valor={potencia(e.potenciaPicoSimultanea)} detalle={p.carga.modo === 'equipos' ? 'Todos los equipos de la franja encendidos' : 'Máximo horario promedio'} />
        <Indicador etiqueta="Potencia de arranque" valor={potencia(e.potenciaArranque)} detalle="Pico + arranque del motor más exigente" tono={e.potenciaArranque > 2 * e.potenciaPicoSimultanea ? 'aviso' : 'normal'} />
      </Rejilla>
      {e.avisos.length > 0 && <div className="mt-3 space-y-2">{e.avisos.map((a, i) => <Aviso key={i} tipo="aviso">{a}</Aviso>)}</div>}

      <Tarjeta className="mt-4" titulo="Curva diaria" subtitulo="Potencia promedio por hora (W).">
        <Grafico opcion={opcionDia} alto={260} />
      </Tarjeta>

      <Tarjeta className="mt-4" titulo="Definición de la carga"
        acciones={<Segmentado valor={p.carga.modo} onChange={cambiarModo} opciones={[{ valor: 'equipos', texto: 'Por equipos' }, { valor: 'mensual', texto: 'Por factura' }]} />}>
        {p.carga.modo === 'equipos' ? (
          <>
            <div className="space-y-3">
              {equipos.map((q) => (
                <div key={q.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-9">
                    <CampoTexto etiqueta="Equipo" valor={q.nombre} onChange={(v) => editar(q.id, { nombre: v })} ancho="col-span-2 sm:col-span-4 lg:col-span-2" />
                    <CampoNumero etiqueta="Potencia" unidad="W" min={0} valor={q.potencia} onChange={(v) => editar(q.id, { potencia: v })} />
                    <CampoNumero etiqueta="Cantidad" min={0} valor={q.cantidad} onChange={(v) => editar(q.id, { cantidad: v })} />
                    <CampoNumero etiqueta="Horas laborable" unidad="h" min={0} max={24} valor={q.horasLaborable} onChange={(v) => editar(q.id, { horasLaborable: v })} />
                    <CampoNumero etiqueta="Horas fin de sem." unidad="h" min={0} max={24} valor={q.horasFinDeSemana} onChange={(v) => editar(q.id, { horasFinDeSemana: v })} />
                    <CampoNumero etiqueta="Desde" unidad="h" min={0} max={23} valor={q.inicio} onChange={(v) => editar(q.id, { inicio: Math.round(v) })} />
                    <CampoNumero etiqueta="Hasta" unidad="h" min={1} max={24} valor={q.fin} onChange={(v) => editar(q.id, { fin: Math.round(v) })} />
                    <CampoNumero etiqueta="Factor arranque" min={1} max={10} valor={q.factorArranque} onChange={(v) => editar(q.id, { factorArranque: v })} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>{fmt((q.potencia * q.cantidad * q.horasLaborable) / 1000, 2)} kWh/día laborable · {fmt((q.potencia * q.cantidad * q.horasFinDeSemana) / 1000, 2)} kWh/día fin de semana</span>
                    <span className="flex gap-1">
                      <Boton variante="fantasma" onClick={() => setEquipos((l) => [...l, { ...q, id: idEquipo(), nombre: `${q.nombre} (copia)` }])}>Duplicar</Boton>
                      <Boton variante="fantasma" onClick={() => setEquipos((l) => l.filter((x) => x.id !== q.id))}>Quitar</Boton>
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <Boton variante="primario" onClick={() => setEquipos((l) => [...l, { id: idEquipo(), nombre: 'Equipo', potencia: 100, cantidad: 1, horasLaborable: 2, horasFinDeSemana: 2, inicio: 0, fin: 24, factorArranque: 1 }])}>Agregar equipo</Boton>
              <Selector etiqueta="o un equipo típico" valor={tipico} onChange={setTipico} ancho="w-64" opciones={TIPICOS.map((t, i) => ({ valor: String(i), texto: `${t.nombre} (${t.potencia} W)` }))} />
              <Boton onClick={() => setEquipos((l) => [...l, { ...TIPICOS[Number(tipico)], id: idEquipo() }])}>Agregar</Boton>
            </div>
            <p className="mt-3 text-xs text-slate-500">Las horas de uso se reparten de forma uniforme dentro de la franja «desde–hasta» (si «hasta» es menor que «desde», la franja cruza la medianoche). El factor de arranque multiplica la potencia del motor en el arranque (típico 3–7).</p>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <Selector<PerfilTipico> etiqueta="Perfil típico" valor={p.carga.perfil} ancho="w-56"
                onChange={(v) => actualizar((x) => (x.carga.modo === 'mensual' ? { ...x, carga: { ...x.carga, perfil: v } } : x))}
                opciones={[{ valor: 'residencial', texto: 'Residencial' }, { valor: 'comercial', texto: 'Comercial (oficina)' }, { valor: 'plano', texto: 'Plano (24 h)' }]} />
              <Boton onClick={() => {
                const v = prompt('Consumo mensual igual para todos los meses (kWh):', String(p.carga.modo === 'mensual' ? p.carga.consumoMensualKWh[0] : 150));
                const n = Number(v?.replace(',', '.'));
                if (Number.isFinite(n) && n >= 0) actualizar((x) => ({ ...x, carga: { modo: 'mensual', consumoMensualKWh: new Array(12).fill(n), perfil: x.carga.modo === 'mensual' ? x.carga.perfil : 'residencial' } }));
              }}>Mismo valor en todos</Boton>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {NOMBRES_MES.map((m, i) => (
                <CampoNumero key={m} etiqueta={m} unidad="kWh" min={0} valor={p.carga.modo === 'mensual' ? p.carga.consumoMensualKWh[i] ?? 0 : 0}
                  onChange={(v) => actualizar((x) => {
                    if (x.carga.modo !== 'mensual') return x;
                    const c = [...x.carga.consumoMensualKWh];
                    while (c.length < 12) c.push(c[0] ?? 0);
                    c[i] = v;
                    return { ...x, carga: { ...x.carga, consumoMensualKWh: c } };
                  })} />
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">Copia los 12 valores de kWh del historial de tu planilla eléctrica. La energía de cada mes se reparte con el perfil horario típico elegido.</p>
            <div className="mt-2 text-sm">Total anual: <b>{fmt(mensual.reduce((a, b) => a + b, 0), 0)} kWh</b></div>
          </>
        )}
      </Tarjeta>
    </>
  );
}
