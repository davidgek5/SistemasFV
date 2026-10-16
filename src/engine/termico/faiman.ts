/**
 * Temperatura de celda, modelo de balance térmico de Faiman (2008) en la forma usada por PVsyst:
 *
 *   U · (Tc − Ta) = α · G_poa · (1 − η),   con  U = Uc + Uv · v_viento
 *
 * Uc: coeficiente constante (W/m²K), Uv: coeficiente de viento (W/m²K por m/s),
 * α: absortancia (PVsyst: 0.9), η: eficiencia del módulo (fracción de la irradiancia
 * convertida en electricidad, PVsyst usa la eficiencia STC).
 */

export type TipoMontaje = 'suelo' | 'techoVentilado' | 'techoIntegrado' | 'personalizado';

export interface ParametrosTermicos {
  montaje: TipoMontaje;
  Uc: number;
  Uv: number;
  absortancia: number;
}

/** Valores predefinidos de PVsyst según el tipo de montaje (Uv = 0, viento no medido). */
export const PRESETS_MONTAJE: Record<Exclude<TipoMontaje, 'personalizado'>, { Uc: number; Uv: number; etiqueta: string; descripcion: string }> = {
  suelo: { Uc: 29, Uv: 0, etiqueta: 'Suelo / estructura libre', descripcion: 'Circulación de aire libre por ambas caras' },
  techoVentilado: { Uc: 20, Uv: 0, etiqueta: 'Techo con ventilación', descripcion: 'Semi-integrado, con cámara de aire posterior' },
  techoIntegrado: { Uc: 15, Uv: 0, etiqueta: 'Techo integrado', descripcion: 'Integrado al edificio, sin ventilación posterior' },
};

export const TERMICO_POR_DEFECTO: ParametrosTermicos = { montaje: 'suelo', Uc: 29, Uv: 0, absortancia: 0.9 };

export function temperaturaCelda(
  poa: number,
  tAmb: number,
  viento: number,
  p: Pick<ParametrosTermicos, 'Uc' | 'Uv' | 'absortancia'>,
  eficienciaModulo: number,
): number {
  const U = p.Uc + p.Uv * Math.max(0, viento);
  return tAmb + (p.absortancia * poa * (1 - eficienciaModulo)) / U;
}
