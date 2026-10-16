/** Módulo 3 (Fase 1: consulta del catálogo semilla). Base CEC completa y equipos propios en la Fase 2. */
import { useMemo, useState } from 'react';
import { Titulo } from '@/components/Layout';
import { Aviso, CampoTexto, Segmentado, Tabla, Tarjeta } from '@/components/ui';
import { BATERIAS, INVERSORES_AISLADOS, INVERSORES_RED, MODULOS, REGULADORES, buscar, nombreEquipo } from '@/catalogo/catalogo';
import { fmt, pct } from '@/lib/formato';

type Tipo = 'modulos' | 'inversores' | 'baterias' | 'reguladores' | 'aislados';

export default function PaginaEquipos() {
  const [tipo, setTipo] = useState<Tipo>('modulos');
  const [q, setQ] = useState('');

  const contenido = useMemo(() => {
    switch (tipo) {
      case 'modulos':
        return {
          cab: ['Módulo', 'Tecnología', 'Pnom W', 'Voc V', 'Vmp V', 'Isc A', 'Imp A', 'η', 'γ %/°C', 'Área m²'],
          filas: buscar(MODULOS, q).map((m) => [nombreEquipo(m), m.tecnologia + (m.bifacial ? ' · bifacial' : ''), fmt(m.pNom, 0), fmt(m.Voc, 2), fmt(m.Vmp, 2), fmt(m.Isc, 2), fmt(m.Imp, 2), pct(m.pNom / (1000 * m.area)), fmt(m.gammaPmp, 3), fmt(m.area, 2)]),
        };
      case 'inversores':
        return {
          cab: ['Inversor', 'Vac', 'Paco kW', 'MPPT V (CEC)', 'Vdc máx. CEC', 'Pso W', 'Pnt W'],
          filas: buscar(INVERSORES_RED, q).map((i) => [nombreEquipo(i), fmt(i.vac, 0), fmt(i.sandia.Paco / 1000, 2), `${fmt(i.sandia.MpptLow, 0)}–${fmt(i.sandia.MpptHigh, 0)}`, fmt(i.sandia.Vdcmax, 0), fmt(i.sandia.Pso, 1), fmt(i.sandia.Pnt, 2)]),
        };
      case 'baterias':
        return {
          cab: ['Batería', 'Química', 'V', 'Ah', 'kWh', 'DoD', 'η ida y vuelta', 'I carga / desc. A', 'Ciclos'],
          filas: buscar(BATERIAS, q).map((b) => [nombreEquipo(b), b.quimica, fmt(b.voltajeNominal, 0), fmt(b.capacidadAh, 0), fmt(b.energiaKWh, 2), pct(b.dodRecomendada, 0), pct(b.eficienciaIda, 0), `${b.corrienteCargaMaxA} / ${b.corrienteDescargaMaxA}`, fmt(b.ciclosVida, 0)]),
        };
      case 'reguladores':
        return {
          cab: ['Regulador', 'Tipo', 'Voc máx. V', 'I salida A', 'Banco V', 'η'],
          filas: buscar(REGULADORES, q).map((r) => [nombreEquipo(r), r.tipo, fmt(r.vocMax, 0), fmt(r.corrienteSalidaA, 0), r.voltajesBateria.join('/'), pct(r.eficiencia, 0)]),
        };
      case 'aislados':
        return {
          cab: ['Inversor', 'Tipo', 'P nominal kW', 'P pico kW', 'Banco V', 'η', 'Vacío W', 'MPPT integrado'],
          filas: buscar(INVERSORES_AISLADOS, q).map((i) => [nombreEquipo(i), i.tipo === 'hibrido' ? 'Híbrido' : 'Off-grid', fmt(i.potenciaNominalW / 1000, 1), fmt(i.potenciaPicoW / 1000, 1), fmt(i.voltajeBateria, 0), pct(i.eficiencia, 0), fmt(i.consumoVacioW, 0), i.mpptIntegrado ? `${i.mpptIntegrado.vMpptMin}–${i.mpptIntegrado.vMpptMax} V` : '—']),
        };
    }
  }, [tipo, q]);

  return (
    <>
      <Titulo titulo="Equipos" subtitulo="Catálogo inicial. En la Fase 2: base CEC completa (≈ 21 000 módulos y 2 300 inversores), equipos propios y precios." />
      <Tarjeta>
        <div className="flex flex-wrap items-end gap-3">
          <Segmentado<Tipo> valor={tipo} onChange={setTipo} opciones={[
            { valor: 'modulos', texto: 'Módulos' }, { valor: 'inversores', texto: 'Inversores de red' }, { valor: 'baterias', texto: 'Baterías' },
            { valor: 'reguladores', texto: 'Reguladores' }, { valor: 'aislados', texto: 'Inversores aislados' },
          ]} />
          <CampoTexto etiqueta="Buscar" valor={q} onChange={setQ} placeholder="Marca o modelo" ancho="w-56" />
        </div>
        <div className="mt-3">
          {(tipo === 'modulos' || tipo === 'inversores') ? (
            <Aviso tipo="info">Parámetros de la base CEC de NREL SAM. En inversores, «MPPT» y «Vdc máx.» son los valores de ensayo CEC: el voltaje y la corriente máximos de entrada se ingresan desde la ficha técnica en «Sistema».</Aviso>
          ) : (
            <Aviso tipo="aviso">Valores típicos de ficha técnica cargados como referencia. Verifica la hoja de datos vigente antes de usarlos en un proyecto.</Aviso>
          )}
        </div>
        <div className="mt-3"><Tabla cabeceras={contenido.cab} filas={contenido.filas} /></div>
      </Tarjeta>
    </>
  );
}
