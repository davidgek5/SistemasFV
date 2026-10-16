# Modelos físicos de SistemasFV

Este documento describe las ecuaciones, supuestos y convenciones del motor de simulación (`src/engine/`),
para validarlo contra PVsyst. Cada modelo tiene tests en `src/engine/__tests__/` que lo comparan con
**pvlib-python 0.16** (implementación de referencia de los mismos modelos). Los valores de referencia se
regeneran con `npm run fixtures` y `python3 scripts/pvlib-fixtures/caso_ibarra.py`.

| Etapa | Modelo | Archivo | Diferencia máxima vs. pvlib |
|---|---|---|---|
| Posición solar | NREL SPA | `solar/spa.ts` | < 1×10⁻⁶ ° |
| Irradiancia extraterrestre | Spencer (1971) | `irradiancia/basicos.ts` | < 1×10⁻⁸ W/m² |
| Masa de aire | Kasten & Young (1989) | `irradiancia/basicos.ts` | < 1×10⁻⁹ |
| Transposición | Perez et al. (1990) | `irradiancia/perez.ts` | < 1×10⁻⁶ W/m² |
| Albedo | Isotrópico | `irradiancia/basicos.ts` | exacto |
| IAM | ASHRAE / Fresnel + Marion (2017) | `irradiancia/iam.ts` | < 1×10⁻⁶ |
| Descomposición | Erbs et al. (1982) | `irradiancia/erbs.ts` | < 1×10⁻⁶ W/m² |
| Temperatura de celda | Faiman (2008), forma PVsyst | `termico/faiman.ts` | < 1×10⁻¹⁰ °C |
| Módulo | Un diodo CEC / De Soto (2006) | `modulo/unDiodo.ts` | Pmp, Voc, Isc < 1×10⁻⁶ relativo |
| Inversor | Sandia (King et al. 2007) | `inversor/sandia.ts` | < 1×10⁻⁶ W |
| Cadena completa (8760 h) | todos | `simular.ts` | E_AC anual < 1×10⁻⁹ relativo |

---

## 1. Convenciones

- **Tiempo.** El año meteorológico tiene 8760 h en **hora local** (Ecuador continental UTC−5, sin horario
  de verano). El índice 0 es el 1 de enero de 00:00 a 01:00. PVGIS y NASA POWER entregan los datos en UTC;
  se rotan 5 h. Las últimas 5 h del 31 de diciembre local vienen del 1 de enero UTC del mismo archivo, lo
  que es correcto para un año típico.
- **Instante de evaluación.** Cada valor horario es un promedio del intervalo [hh:00, hh+1:00). La
  posición solar se evalúa en `hh:00 + desfase`, con desfase = 0.5 h (a mitad de hora, como PVsyst).
  Si el CSV de PVGIS informa *Irradiance Time Offset*, se usa ese valor. **Supuesto a validar:** NASA
  POWER y el JSON de PVGIS se tratan como promedios con inicio en la marca de tiempo (desfase 0.5 h).
- **Azimut: convención PVsyst.** 0° = sur, −90° = este, +90° = oeste, ±180° = norte. Se usa tanto para
  el plano como para el sol y para el horizonte. El perfil de horizonte de PVGIS usa la misma convención;
  pvlib, en cambio, usa 0 = norte, y se convierte con +180°.
- **Calendario.** Se usa el año de referencia 2025 (no bisiesto) solo para los días de la semana del
  perfil de carga. Si un año de NASA es bisiesto, se elimina el 29 de febrero.
- **Unidades.** Irradiancia en W/m², energía horaria en Wh (equivale a W promedio) y temperatura en °C.

## 2. Posición solar — NREL SPA

Reda, I. & Andreas, A. (2004). *Solar position algorithm for solar radiation applications.* Solar Energy
76(5), 577–589. Incertidumbre ±0.0003° entre los años −2000 y 6000.

Es la implementación completa del algoritmo: términos periódicos heliocéntricos L0–L5, B0–B1 y R0–R4,
nutación con 63 términos, aberración, tiempo sidéreo aparente, paralaje topocéntrico y refracción
atmosférica:

  Δe = (P/1010)·(283/(273+T))·1.02 / (60·tan(e₀ + 10.3/(e₀ + 5.11)))

Las tablas se generan automáticamente desde `pvlib.spa`. La presión se calcula a partir de la altitud
con P = 1013.25·(1 − 2.25577×10⁻⁵·h)^5.25588 hPa. Se usan T = 12 °C, ΔT = 69 s y una refracción en el
horizonte de 0.5667°.

## 3. Irradiancia en el plano

**Ángulo de incidencia:** cos θ = cos β·cos z + sin β·sin z·cos(γₛ − γ).

**Directa:** G_b = DNI·max(cos θ, 0). DNI se anula si z ≥ 90°.

**Difusa del cielo, Perez 1990** (Perez, R., Ineichen, P., Seals, R., Michalsky, J., Stewart, R. (1990).
*Modeling daylight availability and irradiance components from direct and global irradiance.* Solar
Energy 44(5), 271–289), con los coeficientes "allsitescomposite1990":

  ε = [(DHI + DNI)/DHI + κz³] / (1 + κz³), κ = 1.041 (z en rad)
  Δ = DHI · AM / I₀
  F₁ = max(0, f₁₁ + f₁₂Δ + f₁₃z), F₂ = f₂₁ + f₂₂Δ + f₂₃z
  G_d = DHI · [ (1 − F₁)(1 + cos β)/2  +  F₁·a/b  +  F₂·sin β ]
          isotrópica                  circunsolar   banda de horizonte
  a = max(0, cos θ), b = max(cos 85°, cos z)

Las tres componentes se guardan por separado, porque el horizonte y el IAM las tratan de forma distinta.

**Albedo (suelo isotrópico):** G_r = GHI·ρ·(1 − cos β)/2, con ρ mensual editable (0.20 por defecto).

**Extraterrestre (Spencer):** I₀ = 1366.1·(1.00011 + 0.034221 cos B + 0.00128 sin B + 0.000719 cos 2B +
0.000077 sin 2B), con B = 2π(n − 1)/365. pvlib usa 1366.1 W/m² y PVsyst 1367 W/m²; la diferencia es de
0.07 % en I₀ y solo afecta a Δ y ε de Perez.

**Masa de aire (Kasten & Young 1989):** AM = 1 / [cos z + 0.50572·(96.07995 − z)^−1.6364].

**Descomposición de Erbs** (Erbs, Klein & Duffie 1982). Se usa solo si un CSV no trae DNI/DHI. Toma
k_t = GHI / (I₀·max(cos z, 0.065)) y calcula la fracción difusa por tramos (≤ 0.22, ≤ 0.8, > 0.8).

## 4. Horizonte lejano

- **Perfil:** altura h(γ) interpolada linealmente de forma circular. Puede venir de PVGIS (`printhorizon`)
  o de un archivo propio con filas "azimut, altura".
- **Directa y circunsolar:** se anulan si la elevación solar es menor que h(γₛ).
- **Difusa isotrópica y banda de horizonte:** se multiplican por un factor constante, la fracción de la
  bóveda celeste visible desde el plano, ponderada por cos θ:
  F_hor = ∫_visible cos θ dΩ / ∫_cielo cos θ dΩ. Se integra numéricamente con pasos de 1° de azimut y
  0.5° de elevación. Test analítico: con un horizonte uniforme de 10° y un plano horizontal, F_hor =
  1 − sin²10°.
- **Albedo:** no se modifica, igual que en PVsyst.
- El TMY de PVGIS se descarga con `usehorizon=0`, para que el horizonte no se aplique dos veces.

## 5. Sombras cercanas (factor), IAM y suciedad

- **Sombras cercanas (Fase 1):** factores constantes, f_b sobre directa + circunsolar y f_d sobre difusa
  + albedo. En la Fase 2 se reemplazan por una tabla de sombreado.
- **IAM ASHRAE:** IAM(θ) = 1 − b₀(1/cos θ − 1), con b₀ = 0.05 (PVsyst).
- **IAM Fresnel:** De Soto et al. (2006), con vidrio de n = 1.526, K = 4 m⁻¹ y L = 2 mm.
- **IAM de la difusa:** se integra el IAM sobre el cielo y sobre el suelo, ponderado por cos θ (Marion, B.
  (2017). *Numerical method for angle-of-incidence correction factors for diffuse radiation incident
  photovoltaic modules.* Solar Energy 147, 344–348). Al cielo isotrópico y a la banda de horizonte se les
  aplica el IAM del cielo; al albedo, el del suelo; a la circunsolar, el IAM del ángulo del sol.
- **Suciedad:** G_ef = G_IAM·(1 − s).

## 6. Bifacial (Fase 2, estructura lista)

G_ef = G_frontal + φ·G_posterior·(1 − sombra_estructura)·(1 − mismatch_posterior). La irradiancia
posterior se calculará con factores de forma 2D para filas infinitas (equivalente al modelo
*unlimited sheds* de PVsyst y a `pvlib.bifacial.infinite_sheds`), a partir de la altura, el GCR y el
albedo del suelo. En la Fase 1 el término posterior vale 0, y la interfaz no permite activarlo.

## 7. Temperatura de celda — Faiman / PVsyst

Faiman, D. (2008). *Assessing the outdoor operating temperature of photovoltaic modules.* Progress in
Photovoltaics 16(4), 307–315. Se usa en la forma de PVsyst:

  T_c = T_a + α·G_poa·(1 − η) / (U_c + U_v·v)

- α = 0.9 (absortancia) y η = eficiencia STC del módulo. G_poa es la irradiancia incidente total, antes
  de IAM y suciedad, como en PVsyst.
- **Valores predefinidos (PVsyst, U_v = 0):** suelo o estructura libre U_c = 29 W/m²K; techo con
  ventilación (semi-integrado) U_c = 20; techo integrado (sin ventilación) U_c = 15.

## 8. Módulo — un diodo CEC (De Soto 2006)

De Soto, W., Klein, S.A., Beckman, W.A. (2006). *Improvement and validation of a model for photovoltaic
array performance.* Solar Energy 80(1), 78–88. Dobos, A. (2012). *An improved coefficient calculator for
the CEC 6 parameter PV module model.* J. Sol. Energy Eng. 134.

  I = I_L − I₀[exp((V + IR_s)/(nN_sV_th)) − 1] − (V + IR_s)/R_sh

Parámetros en condiciones de operación (G efectiva, T_c):

- I_L = (G/1000)·[I_L,ref + α_sc(1 − Adjust/100)(T_c − T_ref)]
- I₀ = I₀,ref·(T_c/T_ref)³·exp[E_g,ref/(kT_ref) − E_g/(kT_c)], con E_g = E_g,ref·[1 + dE_g/dT·(T_c − T_ref)]
  y E_g,ref = 1.121 eV (Si), 1.475 eV (CdTe); dE_g/dT = −0.0002677.
- nN_sV_th = a_ref·T_c/T_ref
- R_sh = R_sh,ref·1000/G
- R_s constante

La curva se resuelve con la forma explícita en el voltaje del diodo (Bishop 1988): el punto de máxima
potencia se halla por sección áurea, y Voc e Isc por Newton.

**Diferencia con PVsyst:** PVsyst usa su propio modelo de un diodo, con R_sh exponencial en G y γ
ajustado a la ficha técnica. Con los mismos parámetros CEC las diferencias suelen quedar por debajo del
1–2 % en la pérdida por nivel de irradiancia. Validar con módulos concretos.

**PVWatts (opcional):** P = P_STC·(G/1000)·[1 + γ(T_c − 25)]. En este modo no se evalúan la ventana
MPPT ni la corriente máxima.

## 9. Pérdidas DC (orden PVsyst)

Se aplican sobre la potencia en el MPP del generador (N módulos idénticos):

1. Nivel de irradiancia: P(G, 25 °C) frente a la energía nominal G·A·η_STC.
2. Temperatura: P(G, T_c) frente a P(G, 25 °C).
3. Calidad del módulo, LID, mismatch y degradación (1 − d)^(año − 1), como factores multiplicativos.
4. Óhmica DC proporcional a I²: ΔP = f_DC·P²/P_STC. La fracción f_DC se define a STC, como en PVsyst.

## 10. Inversor de red — Sandia

King, D.L., Gonzalez, S., Galbraith, G.M., Boyson, W.E. (2007). *Performance Model for Grid-Connected
Photovoltaic Inverters.* SAND2007-5036.

  A = P_dco[1 + C₁(V − V_dco)], B = P_so[1 + C₂(V − V_dco)], C = C₀[1 + C₃(V − V_dco)]
  P_ac = [P_aco/(A − B) − C(A − B)](P_dc − B) + C(P_dc − B)²

- **Ventana MPPT:** si Vmp del string queda fuera de [V_mppt,min, V_mppt,max], el inversor opera en el
  límite y la potencia se recalcula con I(V) del modelo de un diodo. Si Voc < V_mppt,min, la potencia es 0.
- **Corriente máxima:** si I > I_max, el punto se desplaza a la derecha de la curva hasta I = I_max.
  Solo se aplica con el dato de ficha técnica. El campo `Idcmax` de la CEC es un valor de ensayo, no el
  límite de entrada.
- **Umbral de arranque:** si P_dc < P_so, el inversor entrega 0. El consumo nocturno P_nt no se descuenta
  de la producción.
- **Sobrepotencia (recorte):** si P_ac > P_aco, se busca el P_dc que da exactamente P_aco. La diferencia
  se reporta como pérdida DC por sobrepotencia, como en PVsyst.
- Varios inversores reciben la misma fracción de la potencia DC.

## 11. Pérdidas AC e indisponibilidad

- Óhmica AC: ΔP = f_AC·P²/P_aco,total.
- Indisponibilidad: factor uniforme (1 − u). PVsyst, en cambio, reparte días aleatorios de parada; el
  promedio anual es equivalente, pero los valores mensuales pueden diferir.

## 12. Sistemas on-grid

- Autoconsumo = min(P_ac, carga); inyección = P_ac − autoconsumo; compra = carga − autoconsumo, todo
  hora a hora.
- **Balance neto (supuesto editable):** se compensa la energía mes a mes, y el excedente se acredita a los
  meses siguientes del mismo año. Las reglas reales (regulación ARCERNNR de generación distribuida para
  autoabastecimiento) deben verificarse; la parte económica llega en la Fase 3.

## 13. Sistemas off-grid y batería

Es un modelo de balance de energía en paso horario, con bus DC:

- **Generador → regulador:** P_reg = P_MPP·η_reg, limitada a I_reg,max·V_banco·n_reg. Los reguladores
  PWM se modelan como MPPT en la Fase 1; el modelo PWM (operación al voltaje de la batería) va en la
  Fase 2.
- **Necesidad DC:** carga_AC/η_inv + consumo en vacío. Si la carga supera la potencia nominal del
  inversor, el exceso se cuenta como no suministrado.
- **Orden de despacho:** primero FV → carga; luego el excedente carga la batería, y lo que sobra es
  energía no utilizada. Si falta energía, se descarga la batería; lo que no alcanza es energía no
  suministrada.
- **Batería:**
  - Capacidad = energía de ficha × N_s × N_p.
  - η_c = η_d = √η_ida-y-vuelta.
  - SOC ∈ [SOC_min, SOC_max], con SOC_min = 1 − DoD.
  - Potencia limitada por I_max·V_banco.
  - Ciclos equivalentes = energía descargada / capacidad útil.
- **No se modela:** voltaje en función del SOC, efecto Peukert, temperatura ni envejecimiento de la
  batería. Se planea en la Fase 2 (modelo KiBaM para plomo-ácido).

## 14. Indicadores

- Rendimiento específico Y_f = E_salida / P_STC (kWh/kWp).
- PR = E_salida / (H_poa · P_STC / 1000), donde H_poa es la global incidente en el plano antes de las
  pérdidas, igual que en PVsyst. En off-grid, E_salida es la energía entregada a la carga.
- Fracción solar: autoconsumo / carga en on-grid; energía entregada / carga en off-grid.

## 15. Validación de strings (IEC 62548 / PVsyst)

| Verificación | Condición |
|---|---|
| Voc máximo | Voc(1000 W/m², T_amb,mín)·N_s ≤ V_máx entrada (ficha) |
| Vmp mínimo | Vmp(1000 W/m², T_celda = 60 °C)·N_s ≥ V_mppt,mín |
| Vmp máximo | Vmp(1000 W/m², T_celda = 20 °C)·N_s ≤ V_mppt,máx |
| Corriente | Isc(60 °C)·strings por inversor (× 1.25 opcional) ≤ I_máx entrada |
| Relación DC/AC | habitual 1.0–1.3 |

Se calculan con el modelo de un diodo, no con coeficientes lineales.

## 16. Dimensionamiento automático (propuesta inicial)

- **On-grid:** P_FV = E_objetivo / (HSP_plano·365·0.80). Se elige el inversor que deje la relación DC/AC
  entre 0.85 y 1.35 con la menor cantidad de unidades, y luego el tamaño de string dentro del rango válido.
- **Off-grid:** P_FV = E_día / (HSP_plano,mes crítico·0.65) y C_banco = E_día·N_días / (DoD·η_d·η_inv).
  El voltaje del sistema es 12/24/48 V según la potencia pico (≤ 1.2 kW, ≤ 3 kW, > 3 kW).
- HSP_plano se estima con transposición isotrópica sobre totales mensuales. Luego la simulación horaria
  da el resultado exacto.

## 17. Perfil de carga

- **Por equipos:** E_h = P·n·horas/duración_franja dentro de la franja, con valores distintos para días
  laborables y fines de semana.
  - Pico simultáneo = máximo horario de la suma de potencias nominales activas en la franja.
  - Arranque = pico + (k − 1)·P del motor más exigente.
- **Por factura:** los 12 valores de kWh/mes se reparten por día (los fines de semana pesan 1.1 en el
  perfil residencial y 0.45 en el comercial) y por hora, con un perfil típico normalizado.

## 18. Datos multianuales, variabilidad interanual y P50/P90

`src/clima/variabilidad.ts` · tests en `src/clima/variabilidad.test.ts`

**Fuentes de años reales**
- **NASA POWER** (comunidad RE): datos horarios por año, de 2001 al último año completo; por defecto se
  usan los 5 últimos (2021–2025). Se pide un año por petición y cada año se cachea por separado, en el
  CDN del proxy y en IndexedDB.
- **PVGIS 5.3 `seriescalc`** (PVGIS-SARAH3, 2005–2023): se piden el plano horizontal (`angle=0`) y las
  componentes (`components=1`), sin horizonte (`usehorizon=0`).
  - GHI = Gb(i) + Gd(i) + Gr(i); DHI = Gd(i) + Gr(i); DNI = Gb(i)/sin(H_sun).
  - Si H_sun ≤ 2°, la directa se suma a la difusa (DNI = 0), lo que conserva la GHI.
  - La marca "AAAAMMDD:HHMM" trae el minuto del dato satelital (≈ :10). Se usa como desfase para la
    posición solar (MM/60 h) en lugar de los 0.5 h habituales.
- Los años bisiestos pierden el 29 de febrero, y todas las series se rotan a hora local (UTC−5). Se
  guardan redondeadas a 0.1 W/m² y 0.1 °C para no inflar el proyecto.

**Indicadores por año:** GHI anual y mensual, HSP = GHI/365, temperatura media, mínima y máxima, y mes
crítico (el de menor HSP diaria).

**Variabilidad interanual:** sobre la GHI anual de los N años se calculan
  μ = media, σ = desviación estándar muestral (N − 1), CV = σ/μ.
Por mes se calculan la media y la σ entre años.

**P50 / P90 (distribución normal)**
  σ_total = √( σ² + (u·μ)² )
  P50 = μ
  P90 (un año cualquiera) = μ − 1.2816 · σ_total
  P90 (promedio de 10 años) = μ − 1.2816 · √( σ²/10 + (u·μ)² )

- 1.2816 es el cuantil 0.90 de la normal estándar: la probabilidad de excedencia es del 90 %.
- u es la incertidumbre relativa del conjunto de datos. Es editable, con valor por defecto 0 % (solo
  variabilidad interanual); valores típicos: 3–5 % para SARAH y 5–8 % para NASA POWER. La incertidumbre
  del dato es sistemática: no se reduce al promediar años, por eso no se divide por √10.
- **Limitación:** con N = 5 la σ muestral tiene mucha incertidumbre (su intervalo de confianza del 90 % va
  aproximadamente de 0.65σ a 2.4σ). Para estudios bancables se recomiendan N ≥ 10 años, o un ajuste con la
  t de Student (P90 ≈ μ − t₀.₉₀,ₙ₋₁·σ·√(1 + 1/N)), previsto para una fase posterior.
- El mismo método se aplica a la **energía producida** en el modo «simular todos los años»: se simulan las
  8760 h de cada año real, y la P50/P90 sale de la serie de energías anuales. Así se incluyen las no
  linealidades (temperatura, recorte, ventana MPPT) que la P90 de irradiación no captura.

**Peor mes y peor año**
- Peor año: el de menor GHI anual.
- Peor mes: el par mes-año con menor HSP diaria en toda la serie.
- Peor mes promedio: el mes calendario con menor HSP media entre años.
- Para dimensionar off-grid, la HSP en el plano del mes elegido se estima con transposición isotrópica
  sobre totales mensuales (§16). El diseño se comprueba después simulando el peor año, o todos los años,
  hora a hora.

**Promedio multianual hora a hora:** G_prom(h) = (1/N) Σ G_año(h), para la misma hora local de cada año.
- La energía anual simulada con el promedio queda muy cerca de la media de las simulaciones por año. En el
  caso de prueba la diferencia es de 0.05 %.
- En cambio, el promedio suaviza la variabilidad horaria y diaria: hay menos horas de cielo muy claro o
  muy cubierto. Por eso subestima el recorte, los días sin sol y la energía no suministrada en off-grid.
  Para off-grid se recomienda «simular todos los años» o el peor año.

**Comparación de fuentes:** diferencia mensual = (GHI_otra − GHI_ref)/GHI_ref, con el clima principal
(PVGIS TMY) como referencia y los promedios multianuales de NASA y de las series de PVGIS como
alternativas.

## Referencias

1. Reda, I., Andreas, A. (2004). Solar Energy 76(5), 577–589.
2. Perez, R. et al. (1990). Solar Energy 44(5), 271–289.
3. Faiman, D. (2008). Prog. Photovolt. 16(4), 307–315.
4. De Soto, W., Klein, S.A., Beckman, W.A. (2006). Solar Energy 80(1), 78–88.
5. Dobos, A. (2012). J. Sol. Energy Eng. 134(2).
6. King, D.L. et al. (2007). SAND2007-5036, Sandia National Laboratories.
7. Marion, B. (2017). Solar Energy 147, 344–348.
8. Erbs, D.G., Klein, S.A., Duffie, J.A. (1982). Solar Energy 28(4), 293–302.
9. Kasten, F., Young, A.T. (1989). Applied Optics 28(22), 4735–4738.
10. Spencer, J.W. (1971). Search 2(5), 172.
11. Bishop, J.W. (1988). Solar Cells 25(1), 73–89.
12. Holmgren, W., Hansen, C., Mikofski, M. (2018). pvlib python. JOSS 3(29), 884.
13. PVsyst SA. *PVsyst 7/8 Help* — modelos de pérdidas, IAM, temperatura y horizonte.
14. Huld, T. et al. (2012). A new solar radiation database for estimating PV performance in Europe and Africa. Solar Energy 86, 1803–1815 (PVGIS).
15. Stackhouse, P. et al. NASA POWER — Prediction Of Worldwide Energy Resources, Methodology (v2.x).
16. Dobos, A., Gilman, P., Kasberg, M. (2012). P50/P90 Analysis for Solar Energy Systems Using the System Advisor Model. NREL/CP-6A20-54488.
