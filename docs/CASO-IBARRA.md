# Caso de prueba: Ibarra

Este caso permite comparar la app con pvlib (automático, en los tests) y con PVsyst (manual).

## Sistema

| Parámetro | Valor |
|---|---|
| Sitio | Ibarra, Imbabura — 0.35° N, 78.12° O, 2225 m s. n. m., UTC−5 |
| Módulo | Jinko Solar JKM560N-72HL4-TV (560 W, base CEC) |
| Generador | 10 en serie × 1 string = 5.60 kWp |
| Inversor | Fronius Primo 5.0-1 208-240 (5.0 kW, base CEC) |
| Orientación | Inclinación 10°, azimut 0° (sur) |
| Albedo | 0.20 |
| IAM | ASHRAE, b₀ = 0.05 |
| Temperatura | Faiman/PVsyst, U_c = 29 W/m²K, U_v = 0 (suelo / estructura libre) |
| Pérdidas | Suciedad 2 %, calidad −0.4 %, LID 1 %, mismatch 2 %, óhmica DC 1.5 % (STC), óhmica AC 1 %, sin sombras ni indisponibilidad, año 1 |

## 1. Validación automática contra pvlib (clima sintético)

Desde este entorno no se pueden descargar datos de PVGIS ni de NASA. Por eso los tests usan un **año
sintético reproducible** (`public/data/ibarra-sintetico.json`), generado así: cielo claro Ineichen ×
índice de nubosidad AR(1) con semilla fija, y luego Erbs. Sirve para validar el motor, **no** para diseñar.

La misma cadena se calcula en pvlib (`scripts/pvlib-fixtures/caso_ibarra.py`) y en la app (`src/engine/__tests__/casoIbarra.test.ts`):

| Mes | GHI kWh/m² | Plano kWh/m² | Efectiva kWh/m² | E DC kWh | E AC kWh | PR | App E AC kWh | PVsyst E AC kWh |
|---|---|---|---|---|---|---|---|---|
| Ene | 132.0 | 137.3 | 130.8 | 694.3 | 662.0 | 0.861 | 662.0 | |
| Feb | 124.1 | 126.8 | 121.0 | 639.2 | 605.6 | 0.853 | 605.6 | |
| Mar | 134.4 | 133.7 | 127.3 | 676.1 | 644.3 | 0.861 | 644.3 | |
| Abr | 149.9 | 144.9 | 137.9 | 731.6 | 697.1 | 0.859 | 697.1 | |
| May | 158.7 | 149.0 | 141.4 | 750.4 | 715.9 | 0.858 | 715.9 | |
| Jun | 152.8 | 141.4 | 133.8 | 711.1 | 678.7 | 0.857 | 678.7 | |
| Jul | 159.6 | 148.6 | 140.7 | 747.2 | 713.5 | 0.858 | 713.5 | |
| Ago | 171.0 | 163.0 | 154.9 | 819.7 | 782.0 | 0.857 | 782.0 | |
| Sep | 175.7 | 173.0 | 165.4 | 870.0 | 824.9 | 0.851 | 824.9 | |
| Oct | 157.2 | 159.5 | 152.4 | 806.3 | 766.8 | 0.859 | 766.8 | |
| Nov | 138.2 | 143.5 | 137.0 | 726.7 | 692.9 | 0.862 | 692.9 | |
| Dic | 126.5 | 132.3 | 126.0 | 669.7 | 637.2 | 0.860 | 637.2 | |
| **Año** | **1780.1** | **1752.8** | **1668.7** | **8842.3** | **8420.8** | **0.858** | **8420.8** | |

Las columnas de GHI a PR son la referencia de pvlib. La app reproduce la energía AC anual con un error
relativo de 1×10⁻⁹ y los valores horarios con diferencias menores a 0.5 W. Rendimiento específico:
**1504 kWh/kWp**.

Para comparar con PVsyst usando estos mismos datos sintéticos, exporta el clima desde la app
(Ubicación → Exportar CSV) e impórtalo en PVsyst como archivo meteorológico horario en formato texto.

## 2. Comparación con PVsyst (datos reales PVGIS)

1. En la app: abre Proyectos → Nuevo proyecto. Deja Ibarra, elige Ubicación → PVGIS TMY → Descargar y
   configura el sistema de la tabla anterior.
2. Exporta el clima (Ubicación → Archivo original) para usar el **mismo TMY** en PVsyst: en *Databases →
   Import meteo data → PVGIS*, o como archivo de texto.
3. En PVsyst, usa los mismos parámetros. Revisa en especial:
   - transposición Perez;
   - U_c = 29 y U_v = 0;
   - IAM ASHRAE con b₀ = 0.05;
   - pérdidas óhmicas al 1.5 % (STC);
   - LID 1 %, calidad −0.4 % y mismatch 2 %;
   - horizonte: ninguno en una primera corrida, y luego el de PVGIS.
4. Anota en la tabla los valores de PVsyst: *Global incident*, *Effective*, *E_Array* y *E_Grid*. Compara
   también el diagrama de pérdidas línea por línea.

### Fuentes de diferencia esperadas

| Fuente | Efecto típico | Dónde |
|---|---|---|
| Modelo de un diodo (CEC frente al propio de PVsyst) | ±1–2 % en la pérdida por nivel de irradiancia | MODELOS.md §8 |
| Constante solar (1366.1 frente a 1367) | < 0.1 % en la difusa de Perez | §3 |
| Desfase horario de los datos | Puede mover energía entre la mañana y la tarde | §1 |
| Inversor (Sandia CEC frente a la curva de PVsyst) | ±0.5 % | §10 |
| Indisponibilidad (factor fijo frente a días aleatorios) | Mensual | §11 |
