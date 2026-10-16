/** Módulos 4 y 5: tipo de sistema, generador, pérdidas, equipos y dimensionamiento automático. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Titulo } from '@/components/Layout';
import { Aviso, Boton, CampoNumero, Indicador, Insignia, Interruptor, Rejilla, Segmentado, Selector, Tabla, Tarjeta } from '@/components/ui';
import { useProyecto } from '@/proyecto/store';
import { cargaDelProyecto, climaParaSimular, fuentesDisponibles, NOMBRE_FUENTE, puedeSimular, seriesDeFuente } from '@/proyecto/entrada';
import { SelectorDatosSimulacion } from '@/components/SelectorDatosSimulacion';
import { analizar } from '@/clima/variabilidad';
import { NOMBRES_MES } from '@/engine/calendario';
import type { TipoSistema } from '@/proyecto/esquema';
import { BATERIAS, INVERSORES_AISLADOS, INVERSORES_RED, MODULOS, REGULADORES, nombreEquipo } from '@/catalogo/catalogo';
import { PRESETS_MONTAJE, type TipoMontaje } from '@/engine/termico/faiman';
import { rangoSerie, validarStrings, vMaxEntrada } from '@/engine/dimensionamiento/strings';
import { hspPlanoMensual, proponerOffGrid, proponerOnGrid } from '@/engine/dimensionamiento/automatico';
import { resumenMensual } from '@/clima/resumen';
import type { Perdidas } from '@/engine/tipos';
import { fmt, pct } from '@/lib/formato';

const estadoTono = { ok: 'verde', aviso: 'ambar', error: 'rojo' } as const;
const estadoTexto = { ok: 'Correcto', aviso: 'Revisar', error: 'No cumple' } as const;

export default function PaginaSistema() {
  const p = useProyecto((s) => s.proyecto)!;
  const actualizar = useProyecto((s) => s.actualizar);
  const navegar = useNavigate();
  const [cobertura, setCobertura] = useState(1);
  const [mensajesDim, setMensajesDim] = useState<string[]>([]);
  const [baseDiseno, setBaseDiseno] = useState<'activo' | 'peorMes' | 'peorAnio'>('activo');
  const g = p.generador;
  const setGen = (c: Partial<typeof g>) => actualizar((x) => ({ ...x, generador: { ...x.generador, ...c } }));
  const setPerd = (c: Partial<Perdidas>) => actualizar((x) => ({ ...x, generador: { ...x.generador, perdidas: { ...x.generador.perdidas, ...c } } }));
  const setOn = (c: Partial<typeof p.onGrid>) => actualizar((x) => ({ ...x, onGrid: { ...x.onGrid, ...c } }));
  const setOff = (c: Partial<typeof p.offGrid>) => actualizar((x) => ({ ...x, offGrid: { ...x.offGrid, ...c } }));
  const setBanco = (c: Partial<typeof p.offGrid.banco>) => actualizar((x) => ({ ...x, offGrid: { ...x.offGrid, banco: { ...x.offGrid.banco, ...c } } }));

  const nMod = g.nSerie * g.nParalelo;
  const kWp = (nMod * g.modulo.pNom) / 1000;
  const carga = useMemo(() => cargaDelProyecto(p).estadisticas, [p.carga]); // eslint-disable-line react-hooks/exhaustive-deps
  const hayDatos = puedeSimular(p) || !!p.clima;
  const climaSim = useMemo(() => { try { return climaParaSimular(p); } catch { return null; } }, [p.clima, p.seriesAnuales, p.datosSimulacion]); // eslint-disable-line react-hooks/exhaustive-deps
  const clima = useMemo(() => (climaSim ? resumenMensual(climaSim.clima) : null), [climaSim]);
  const hsp = useMemo(() => (clima ? hspPlanoMensual(clima.meses.map((m) => m.ghi), clima.meses.map((m) => m.dhi), g.inclinacion, g.albedo[0]) : null), [clima, g.inclinacion, g.albedo]);
  // Base de diseño off-grid a partir de las series multianuales (fuente elegida o la primera disponible)
  const fuenteSeries = fuentesDisponibles(p).includes(p.datosSimulacion.fuente) ? p.datosSimulacion.fuente : fuentesDisponibles(p)[0];
  const multianual = useMemo(() => {
    if (!fuenteSeries) return null;
    const series = seriesDeFuente(p, fuenteSeries);
    const a = analizar(series);
    const hspDe = (ghi: number[], dhi: number[]) => hspPlanoMensual(ghi, dhi, g.inclinacion, g.albedo[0]);
    let peorMes = { anio: 0, mes: 0, hsp: Infinity };
    for (const y of a.anios) hspDe(y.ghiMensual, y.dhiMensual).forEach((h, m) => { if (h < peorMes.hsp) peorMes = { anio: y.anio, mes: m, hsp: h }; });
    const hPeorAnio = hspDe(a.peorAnio.ghiMensual, a.peorAnio.dhiMensual);
    const mPeorAnio = hPeorAnio.indexOf(Math.min(...hPeorAnio));
    return { fuente: fuenteSeries, peorMes, peorAnio: { anio: a.peorAnio.anio, mes: mPeorAnio, hsp: hPeorAnio[mPeorAnio] } };
  }, [fuenteSeries, p.seriesAnuales, g.inclinacion, g.albedo]); // eslint-disable-line react-hooks/exhaustive-deps
  const tMinSitio = clima ? Math.floor(clima.anual.tmin) - 2 : null;

  const verificaciones = useMemo(
    () => (p.tipoSistema === 'on-grid' ? validarStrings(g.modulo, p.onGrid.inversor, g.nSerie, g.nParalelo, p.onGrid.nInversores, p.criteriosStrings) : []),
    [g.modulo, g.nSerie, g.nParalelo, p.onGrid, p.criteriosStrings, p.tipoSistema],
  );
  const rango = useMemo(() => rangoSerie(g.modulo, p.onGrid.inversor, p.criteriosStrings), [g.modulo, p.onGrid.inversor, p.criteriosStrings]);

  const dimensionar = () => {
    if (!hsp) return setMensajesDim(['Primero carga los datos meteorológicos (o elige datos multianuales descargados).']);
    if (p.tipoSistema === 'on-grid') {
      const hspAnual = hsp.reduce((a, b, m) => a + b * [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m], 0) / 365;
      const r = proponerOnGrid(carga.energiaAnual * cobertura, hspAnual, g.modulo, INVERSORES_RED, p.criteriosStrings);
      if (!r.inversor) return setMensajesDim(r.notas);
      actualizar((x) => ({ ...x, generador: { ...x.generador, nSerie: r.nSerie, nParalelo: r.nParalelo }, onGrid: { ...x.onGrid, inversor: r.inversor!, nInversores: r.nInversores } }));
      setMensajesDim([
        `Objetivo ${fmt(carga.energiaAnual * cobertura, 0)} kWh/año → ${fmt(r.potenciaObjetivoKWp, 2)} kWp (HSP en el plano ${fmt(hspAnual, 2)}, PR supuesto 0.80).`,
        `Propuesta: ${r.nSerie} módulos × ${r.nParalelo} string(s) = ${fmt((r.nModulos * g.modulo.pNom) / 1000, 2)} kWp; ${r.nInversores} × ${nombreEquipo(r.inversor)} (DC/AC ${fmt(r.relacionDCAC, 2)}).`,
        ...r.notas,
      ]);
    } else {
      let hspDiseno = Math.min(...hsp);
      let textoBase = `mes crítico de los datos de simulación (${NOMBRES_MES[hsp.indexOf(hspDiseno)]})`;
      if (baseDiseno !== 'activo' && multianual) {
        const b = baseDiseno === 'peorMes' ? multianual.peorMes : multianual.peorAnio;
        hspDiseno = b.hsp;
        textoBase = baseDiseno === 'peorMes' ? `peor mes de la serie: ${NOMBRES_MES[b.mes]} ${b.anio}` : `mes crítico del peor año ${b.anio} (${NOMBRES_MES[b.mes]})`;
      }
      const r = proponerOffGrid({
        energiaDiariaWh: carga.energiaDiariaPromedio, hspPlanoMesCritico: hspDiseno, potenciaPicoCargaW: carga.potenciaPicoSimultanea,
        potenciaArranqueW: carga.potenciaArranque, diasAutonomia: p.offGrid.diasAutonomia, modulo: g.modulo, baterias: BATERIAS,
        reguladores: REGULADORES, inversores: INVERSORES_AISLADOS, tAmbMin: p.criteriosStrings.tAmbMin, quimica: p.offGrid.banco.bateria.quimica,
      });
      actualizar((x) => ({
        ...x,
        generador: { ...x.generador, nSerie: r.nSerie, nParalelo: r.nParalelo },
        offGrid: {
          ...x.offGrid,
          banco: r.bateria ? { ...x.offGrid.banco, bateria: r.bateria, nSerie: r.bateriasSerie, nParalelo: r.bateriasParalelo, socMin: +(1 - r.bateria.dodRecomendada).toFixed(2) } : x.offGrid.banco,
          regulador: r.regulador ?? x.offGrid.regulador, nReguladores: r.nReguladores, inversor: r.inversor ?? x.offGrid.inversor,
        },
      }));
      setMensajesDim([
        `Energía diaria ${fmt(r.energiaDiariaWh / 1000, 2)} kWh; base de diseño: ${textoBase}, HSP en el plano ${fmt(hspDiseno, 2)} → ${fmt(r.potenciaFVkWp, 2)} kWp (PR aislado 0.65).`,
        `Banco requerido ${fmt(r.capacidadRequeridaWh / 1000, 1)} kWh para ${p.offGrid.diasAutonomia} día(s) de autonomía${r.bateria ? `: ${r.bateriasSerie}S × ${r.bateriasParalelo}P ${nombreEquipo(r.bateria)}` : ''}.`,
        ...r.notas,
      ]);
    }
  };

  const banco = p.offGrid.banco;
  const vBanco = banco.bateria.voltajeNominal * banco.nSerie;
  const kWhBanco = banco.bateria.energiaKWh * banco.nSerie * banco.nParalelo;

  return (
    <>
      <Titulo titulo="Sistema" subtitulo="Configura el generador y los equipos, o deja que la app proponga un dimensionamiento."
        acciones={<Boton variante="primario" onClick={() => navegar('/resultados')}>Simular →</Boton>} />

      <Tarjeta titulo="Tipo de sistema">
        <Segmentado<TipoSistema> valor={p.tipoSistema} onChange={(v) => actualizar((x) => ({ ...x, tipoSistema: v }))} opciones={[
          { valor: 'on-grid', texto: 'On-grid (red)' }, { valor: 'off-grid', texto: 'Off-grid (aislado)' }, { valor: 'hibrido', texto: 'Híbrido · Fase 2', disabled: true },
        ]} />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {p.tipoSistema === 'on-grid' ? (
            <>
              <Selector etiqueta="Modalidad" valor={p.onGrid.modalidad} onChange={(v) => setOn({ modalidad: v })} opciones={[
                { valor: 'balanceNeto', texto: 'Balance neto (compensación mensual)' }, { valor: 'autoconsumo', texto: 'Autoconsumo (sin compensación)' },
              ]} />
              <CampoNumero etiqueta="Cobertura objetivo del consumo" valor={cobertura * 100} unidad="%" min={5} max={200} onChange={(v) => setCobertura(v / 100)} />
            </>
          ) : (
            <>
              <CampoNumero etiqueta="Días de autonomía" valor={p.offGrid.diasAutonomia} min={0.5} max={10} unidad="días" onChange={(v) => setOff({ diasAutonomia: v })} />
              <Selector etiqueta="Base de diseño (irradiación)" valor={baseDiseno} onChange={setBaseDiseno}
                opciones={[
                  { valor: 'activo', texto: 'Mes crítico de los datos de simulación' },
                  { valor: 'peorMes', texto: multianual ? `Peor mes multianual (${NOMBRES_MES[multianual.peorMes.mes]} ${multianual.peorMes.anio})` : 'Peor mes multianual (sin años)', disabled: !multianual },
                  { valor: 'peorAnio', texto: multianual ? `Peor año (${multianual.peorAnio.anio})` : 'Peor año (sin años)', disabled: !multianual },
                ]}
                ayuda={multianual ? `Series de ${NOMBRE_FUENTE[multianual.fuente]}. HSP en el plano: peor mes ${fmt(multianual.peorMes.hsp, 2)} · peor año ${fmt(multianual.peorAnio.hsp, 2)}` : 'Descarga años en Ubicación → Datos multianuales'} />
            </>
          )}
          <div className="flex items-end"><Boton onClick={dimensionar} disabled={!hsp}>Dimensionar automáticamente</Boton></div>
        </div>
        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800"><SelectorDatosSimulacion /></div>
        {!hayDatos && <div className="mt-3"><Aviso tipo="aviso">Carga los datos meteorológicos en «Ubicación» para dimensionar y simular.</Aviso></div>}
        {p.tipoSistema === 'off-grid' && multianual && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-500">Comprobar el diseño con el peor año:</span>
            <Boton onClick={() => { actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, modo: 'anio', fuente: multianual.fuente, anio: multianual.peorAnio.anio } })); navegar('/resultados'); }}>
              Simular {multianual.peorAnio.anio}
            </Boton>
            <Boton onClick={() => { actualizar((x) => ({ ...x, datosSimulacion: { ...x.datosSimulacion, modo: 'todos', fuente: multianual.fuente } })); navegar('/resultados'); }}>Simular todos los años</Boton>
          </div>
        )}
        {mensajesDim.length > 0 && <div className="mt-3"><Aviso tipo="info"><ul className="list-disc space-y-1 pl-4">{mensajesDim.map((m, i) => <li key={i}>{m}</li>)}</ul></Aviso></div>}
      </Tarjeta>

      <Tarjeta className="mt-4" titulo="Generador fotovoltaico" subtitulo={`${nMod} módulos · ${fmt(kWp, 2)} kWp · ${fmt(nMod * g.modulo.area, 1)} m²`}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Selector etiqueta="Módulo" valor={g.modulo.id} ancho="sm:col-span-2" onChange={(id) => setGen({ modulo: MODULOS.find((m) => m.id === id)! })}
            opciones={MODULOS.map((m) => ({ valor: m.id, texto: `${nombreEquipo(m)} — ${m.pNom} W${m.bifacial ? ' (bifacial)' : ''}` }))}
            ayuda={`Voc ${fmt(g.modulo.Voc, 1)} V · Vmp ${fmt(g.modulo.Vmp, 1)} V · Isc ${fmt(g.modulo.Isc, 2)} A · η ${pct(g.modulo.pNom / (1000 * g.modulo.area))} · γ ${fmt(g.modulo.gammaPmp, 3)} %/°C`} />
          <Selector etiqueta="Modelo del módulo" valor={g.modeloModulo} onChange={(v) => setGen({ modeloModulo: v })} opciones={[
            { valor: 'cec', texto: 'Un diodo (CEC / De Soto)' }, { valor: 'pvwatts', texto: 'PVWatts (simplificado)' },
          ]} />
          <div />
          <CampoNumero etiqueta="Módulos en serie" valor={g.nSerie} min={1} max={60} onChange={(v) => setGen({ nSerie: Math.round(v) })}
            ayuda={p.tipoSistema === 'on-grid' ? `Rango válido: ${rango.nMin}–${rango.nMax}` : undefined} />
          <CampoNumero etiqueta="Strings en paralelo" valor={g.nParalelo} min={1} max={500} onChange={(v) => setGen({ nParalelo: Math.round(v) })} />
          <CampoNumero etiqueta="Inclinación" valor={g.inclinacion} unidad="°" min={0} max={90} onChange={(v) => setGen({ inclinacion: v })}
            ayuda={g.inclinacion < 10 ? 'Menos de 10°: la lluvia no limpia bien los módulos.' : 'Cerca del ecuador, 10° favorece la autolimpieza.'} />
          <CampoNumero etiqueta="Azimut" valor={g.azimut} unidad="°" min={-180} max={180} onChange={(v) => setGen({ azimut: v })} ayuda="0 = sur, −90 = este, +90 = oeste" />
          <CampoNumero etiqueta="Albedo" valor={g.albedo[0]} min={0} max={1} decimales={2} onChange={(v) => setGen({ albedo: new Array(12).fill(v) })} ayuda="Pasto 0.20 · concreto 0.30 · techo blanco 0.6" />
          <Selector<TipoMontaje> etiqueta="Montaje (temperatura de celda)" valor={g.termico.montaje}
            onChange={(v) => setGen({ termico: v === 'personalizado' ? { ...g.termico, montaje: v } : { ...g.termico, montaje: v, Uc: PRESETS_MONTAJE[v].Uc, Uv: PRESETS_MONTAJE[v].Uv } })}
            opciones={[
              ...(Object.entries(PRESETS_MONTAJE) as [Exclude<TipoMontaje, 'personalizado'>, (typeof PRESETS_MONTAJE)['suelo']][]).map(([k, v]) => ({ valor: k, texto: `${v.etiqueta} (Uc = ${v.Uc})` })),
              { valor: 'personalizado', texto: 'Personalizado' },
            ]} ayuda={g.termico.montaje !== 'personalizado' ? PRESETS_MONTAJE[g.termico.montaje].descripcion : 'Valores propios de Uc y Uv'} />
          <CampoNumero etiqueta="Uc" unidad="W/m²K" valor={g.termico.Uc} min={1} max={60} onChange={(v) => setGen({ termico: { ...g.termico, Uc: v, montaje: 'personalizado' } })} />
          <CampoNumero etiqueta="Uv" unidad="W/m²K·m/s" valor={g.termico.Uv} min={0} max={10} onChange={(v) => setGen({ termico: { ...g.termico, Uv: v, montaje: 'personalizado' } })} />
          <Selector etiqueta="IAM" valor={g.iam.tipo === 'fresnel' ? 'fresnel' : 'ashrae'}
            onChange={(v) => setGen({ iam: v === 'fresnel' ? { tipo: 'fresnel', n: 1.526, K: 4, L: 0.002 } : { tipo: 'ashrae', b0: 0.05 } })}
            opciones={[{ valor: 'ashrae', texto: 'ASHRAE (b0)' }, { valor: 'fresnel', texto: 'Fresnel (vidrio n = 1.526)' }]} />
          {g.iam.tipo === 'ashrae' && <CampoNumero etiqueta="b0" valor={g.iam.b0} min={0} max={0.2} decimales={3} onChange={(v) => setGen({ iam: { tipo: 'ashrae', b0: v } })} ayuda="PVsyst: 0.05" />}
        </div>
        <div className="mt-4 rounded-xl border border-dashed border-slate-300 p-3 dark:border-slate-700">
          <Interruptor etiqueta="Módulo bifacial" valor={false} disabled onChange={() => undefined}
            ayuda={`Fase 2: factor de bifacialidad, altura y albedo del suelo (modelo de filas infinitas). ${g.modulo.bifacial ? 'Este módulo es bifacial; por ahora se simula solo la cara frontal.' : ''}`} />
        </div>
      </Tarjeta>

      <Tarjeta className="mt-4" titulo="Pérdidas" subtitulo="En porcentaje. Valores por defecto similares a los de PVsyst.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {([
            ['suciedad', 'Suciedad'], ['sombraDirecta', 'Sombras (directa)'], ['sombraDifusa', 'Sombras (difusa)'], ['calidadModulo', 'Calidad del módulo'],
            ['lid', 'LID'], ['mismatch', 'Mismatch'], ['ohmicaDC', 'Cableado DC (a STC)'], ['ohmicaAC', 'Cableado AC (a Pnom)'], ['indisponibilidad', 'Indisponibilidad'],
            ['degradacionAnual', 'Degradación anual'],
          ] as [keyof Perdidas, string][]).map(([k, t]) => (
            <CampoNumero key={k} etiqueta={t} unidad="%" decimales={2} min={k === 'calidadModulo' ? -5 : 0} max={50} valor={g.perdidas[k] * 100} onChange={(v) => setPerd({ [k]: v / 100 })} />
          ))}
          <CampoNumero etiqueta="Año de operación" valor={g.perdidas.anioOperacion} min={1} max={40} onChange={(v) => setPerd({ anioOperacion: Math.round(v) })} ayuda="Aplica la degradación acumulada" />
        </div>
        <p className="mt-2 text-xs text-slate-500">Calidad del módulo negativa = tolerancia positiva (ganancia). Las pérdidas óhmicas varían con el cuadrado de la corriente, como en PVsyst.</p>
      </Tarjeta>

      {p.tipoSistema === 'on-grid' && (
        <Tarjeta className="mt-4" titulo="Inversor de red y validación de strings">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Selector etiqueta="Inversor" valor={p.onGrid.inversor.id} ancho="sm:col-span-2"
              onChange={(id) => setOn({ inversor: INVERSORES_RED.find((i) => i.id === id)! })}
              opciones={INVERSORES_RED.map((i) => ({ valor: i.id, texto: `${nombreEquipo(i)} — ${fmt(i.sandia.Paco / 1000, 1)} kW` }))}
              ayuda={`MPPT ${fmt(p.onGrid.inversor.sandia.MpptLow, 0)}–${fmt(p.onGrid.inversor.sandia.MpptHigh, 0)} V (CEC) · Pso ${fmt(p.onGrid.inversor.sandia.Pso, 0)} W`} />
            <CampoNumero etiqueta="Número de inversores" valor={p.onGrid.nInversores} min={1} max={100} onChange={(v) => setOn({ nInversores: Math.round(v) })} />
            <div />
            <CampoNumero etiqueta="V máx. de entrada (ficha)" unidad="V" valor={p.onGrid.inversor.vdcMaxEntrada ?? 0} min={0}
              onChange={(v) => setOn({ inversor: { ...p.onGrid.inversor, vdcMaxEntrada: v || null } })}
              ayuda={p.onGrid.inversor.vdcMaxEntrada ? 'Dato de ficha técnica' : `Vacío: se usa ${fmt(vMaxEntrada(p.onGrid.inversor).valor, 0)} V (CEC, provisional)`} />
            <CampoNumero etiqueta="I máx. de entrada (ficha, total)" unidad="A" valor={p.onGrid.inversor.idcMaxEntrada ?? 0} min={0}
              onChange={(v) => setOn({ inversor: { ...p.onGrid.inversor, idcMaxEntrada: v || null } })} ayuda="Suma de todas las entradas MPPT" />
            <CampoNumero etiqueta="T ambiente mínima" unidad="°C" valor={p.criteriosStrings.tAmbMin}
              onChange={(v) => actualizar((x) => ({ ...x, criteriosStrings: { ...x.criteriosStrings, tAmbMin: v } }))}
              ayuda={tMinSitio !== null ? `Mínima del clima − 2 °C ≈ ${tMinSitio} °C` : 'Para Voc máximo'} />
            <CampoNumero etiqueta="T celda verano / invierno" unidad="°C" valor={p.criteriosStrings.tCeldaVerano}
              onChange={(v) => actualizar((x) => ({ ...x, criteriosStrings: { ...x.criteriosStrings, tCeldaVerano: v } }))} ayuda={`Invierno: ${p.criteriosStrings.tCeldaInvierno} °C`} />
          </div>
          <div className="mt-4">
            <Tabla cabeceras={['Verificación', 'Valor', 'Límite', 'Estado']} alinear={['izq', 'der', 'der', 'izq']}
              filas={verificaciones.map((v) => [
                <span key="d">{v.descripcion}{v.detalle && <span className="block text-xs text-slate-500">{v.detalle}</span>}</span>,
                `${fmt(v.valor, v.unidad ? 1 : 2)} ${v.unidad}`,
                v.limite === null ? '—' : `${fmt(v.limite, v.unidad ? 0 : 2)} ${v.unidad}`,
                <Insignia key="e" tono={estadoTono[v.estado]}>{estadoTexto[v.estado]}</Insignia>,
              ])} />
          </div>
        </Tarjeta>
      )}

      {p.tipoSistema === 'off-grid' && (
        <Tarjeta className="mt-4" titulo="Banco de baterías, regulador e inversor">
          <Rejilla>
            <Indicador etiqueta="Banco" valor={`${fmt(kWhBanco, 1)} kWh`} detalle={`${vBanco} V · ${banco.nSerie}S × ${banco.nParalelo}P`} />
            <Indicador etiqueta="Energía útil" valor={`${fmt(kWhBanco * (banco.socMax - banco.socMin), 1)} kWh`} detalle={`DoD ${pct(banco.socMax - banco.socMin, 0)}`} />
            <Indicador etiqueta="Autonomía estimada" valor={fmt((kWhBanco * 1000 * (banco.socMax - banco.socMin) * Math.sqrt(banco.bateria.eficienciaIda) * p.offGrid.inversor.eficiencia) / Math.max(1, carga.energiaDiariaPromedio), 1)} unidad="días" />
            <Indicador etiqueta="Inversor / carga pico" valor={`${fmt(p.offGrid.inversor.potenciaNominalW / 1000, 1)} kW`} detalle={`Pico de la carga ${fmt(carga.potenciaPicoSimultanea / 1000, 2)} kW · arranque ${fmt(carga.potenciaArranque / 1000, 2)} kW`}
              tono={p.offGrid.inversor.potenciaNominalW < carga.potenciaPicoSimultanea || p.offGrid.inversor.potenciaPicoW < carga.potenciaArranque ? 'mal' : 'normal'} />
          </Rejilla>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Selector etiqueta="Batería" valor={banco.bateria.id} ancho="sm:col-span-2" onChange={(id) => {
              const b = BATERIAS.find((x) => x.id === id)!;
              setBanco({ bateria: b, socMin: +(1 - b.dodRecomendada).toFixed(2) });
            }} opciones={BATERIAS.map((b) => ({ valor: b.id, texto: `${nombreEquipo(b)} — ${b.voltajeNominal} V, ${fmt(b.energiaKWh, 2)} kWh (${b.quimica})` }))} ayuda={banco.bateria.nota} />
            <CampoNumero etiqueta="Baterías en serie" valor={banco.nSerie} min={1} max={48} onChange={(v) => setBanco({ nSerie: Math.round(v) })} />
            <CampoNumero etiqueta="Ramas en paralelo" valor={banco.nParalelo} min={1} max={50} onChange={(v) => setBanco({ nParalelo: Math.round(v) })} />
            <CampoNumero etiqueta="Profundidad de descarga máx." unidad="%" valor={(1 - banco.socMin) * 100} min={10} max={100} onChange={(v) => setBanco({ socMin: +(1 - v / 100).toFixed(3) })} />
            <CampoNumero etiqueta="SOC inicial" unidad="%" valor={banco.socInicial * 100} min={0} max={100} onChange={(v) => setBanco({ socInicial: v / 100 })} />
            <Selector etiqueta="Regulador" valor={p.offGrid.regulador.id} ancho="sm:col-span-2" onChange={(id) => setOff({ regulador: REGULADORES.find((r) => r.id === id)! })}
              opciones={REGULADORES.map((r) => ({ valor: r.id, texto: `${nombreEquipo(r)} — ${r.vocMax} V / ${r.corrienteSalidaA} A` }))}
              ayuda={`Banco admitido: ${p.offGrid.regulador.voltajesBateria.join('/')} V · Voc del string a T mín ≈ ${fmt(g.nSerie * g.modulo.Voc * (1 + (g.modulo.betaVoc / g.modulo.Voc) * (p.criteriosStrings.tAmbMin - 25)), 0)} V`} />
            <CampoNumero etiqueta="Reguladores" valor={p.offGrid.nReguladores} min={1} max={20} onChange={(v) => setOff({ nReguladores: Math.round(v) })} />
            <div />
            <Selector etiqueta="Inversor aislado" valor={p.offGrid.inversor.id} ancho="sm:col-span-2" onChange={(id) => setOff({ inversor: INVERSORES_AISLADOS.find((r) => r.id === id)! })}
              opciones={INVERSORES_AISLADOS.map((r) => ({ valor: r.id, texto: `${nombreEquipo(r)} — ${fmt(r.potenciaNominalW / 1000, 1)} kW, ${r.voltajeBateria} V` }))}
              ayuda={`η ${pct(p.offGrid.inversor.eficiencia, 0)} · consumo en vacío ${p.offGrid.inversor.consumoVacioW} W · pico ${fmt(p.offGrid.inversor.potenciaPicoW / 1000, 1)} kW`} />
          </div>
          {(() => {
            const avisos: string[] = [];
            if (!p.offGrid.regulador.voltajesBateria.includes(vBanco)) avisos.push(`El regulador no admite un banco de ${vBanco} V.`);
            if (p.offGrid.inversor.voltajeBateria !== vBanco) avisos.push(`El inversor es de ${p.offGrid.inversor.voltajeBateria} V y el banco de ${vBanco} V.`);
            const vocFrio = g.nSerie * g.modulo.Voc * (1 + (g.modulo.betaVoc / g.modulo.Voc) * (p.criteriosStrings.tAmbMin - 25));
            if (vocFrio > p.offGrid.regulador.vocMax) avisos.push(`El Voc del string (${fmt(vocFrio, 0)} V) supera el máximo del regulador (${p.offGrid.regulador.vocMax} V).`);
            return avisos.length ? <div className="mt-3 space-y-2">{avisos.map((a, i) => <Aviso key={i} tipo="error">{a}</Aviso>)}</div> : null;
          })()}
        </Tarjeta>
      )}
    </>
  );
}
