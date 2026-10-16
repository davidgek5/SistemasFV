# SistemasFV

Aplicación web para dimensionar y simular sistemas fotovoltaicos hora a hora (8760 h): on-grid,
off-grid y, en la Fase 2, híbridos. Funciona en el celular y en la PC sin instalar nada y está
pensada para proyectos en Ecuador. Toda la interfaz está en español.

- **Motor físico propio en TypeScript** (`src/engine/`): SPA, Perez 1990, IAM, Faiman, un diodo CEC/De
  Soto, inversor Sandia, horizonte lejano y balance de batería. Cada modelo está validado contra pvlib;
  ver [MODELOS.md](MODELOS.md).
- **Datos meteorológicos:** PVGIS TMY 5.3 y NASA POWER, mediante funciones serverless que hacen de proxy
  y caché, o desde un CSV propio.
- **Caso de prueba:** Ibarra, en [docs/CASO-IBARRA.md](docs/CASO-IBARRA.md).

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Ubicación + clima, perfil de carga, simulación on-grid y off-grid, cascada de pérdidas, validación de strings, dimensionamiento automático | ✅ |
| 2 | Base CEC completa, equipos propios, híbrido, bifacial, horizonte (interfaz completa), sombras detalladas, TMY de NASA | ⏳ |
| 3 | Conductores, protecciones, economía (LCOE, VAN, TIR) y PDF | ⏳ |
| 4 | Despliegue en Vercel con dominio | ⏳ |

## Desarrollo

```bash
npm install
npm run dev        # http://localhost:5173 (las funciones /api también corren en local)
npm test           # 60 tests de Vitest
npm run build
```

Para regenerar los valores de referencia: `pip install pvlib`, luego `npm run fixtures` y
`python3 scripts/pvlib-fixtures/caso_ibarra.py`.

## Estructura

```
api/            Funciones serverless (Vercel): /api/pvgis-tmy, /api/pvgis-horizonte, /api/nasa-power
scripts/        Generación del catálogo CEC y de los valores de referencia con pvlib
src/engine/     Física pura (sin React): solar, irradiancia, térmico, módulo, inversor, batería, carga…
src/clima/      Lectores PVGIS/NASA (JSON y CSV), resumen mensual, descargas con caché
src/catalogo/   Equipos (semilla CEC + baterías, reguladores, inversores aislados)
src/proyecto/   Esquema del proyecto (zod), IndexedDB (Dexie), estado global (zustand)
src/workers/    Simulación en un Web Worker
src/features/   Páginas: proyectos, ubicación, carga, sistema, resultados, equipos
```

## Despliegue en Vercel

1. Crea una cuenta en [vercel.com](https://vercel.com) con tu usuario de GitHub.
2. Elige *Add New → Project*, importa el repositorio `SistemasFV` y pulsa *Deploy*. Vercel detecta Vite
   y las funciones de `/api` automáticamente.
3. Cada `git push` genera una nueva versión. Las ramas tienen su propio enlace de vista previa.

## Licencias de datos

- Base de módulos e inversores CEC: NREL System Advisor Model (BSD-3).
- PVGIS: © Unión Europea, JRC.
- NASA POWER: NASA Langley Research Center.
- Mapas: © colaboradores de OpenStreetMap.
