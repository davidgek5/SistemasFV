/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * En desarrollo (`npm run dev`) sirve las funciones de /api con el mismo código que usa
 * Vercel, para no necesitar la CLI de Vercel.
 */
function apiLocal(): Plugin {
  return {
    name: 'api-local',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const nombre = url.pathname.replace(/^\/api\//, '').replace(/[^a-z0-9-]/gi, '');
        try {
          const mod = await server.ssrLoadModule(`/api/${nombre}.ts`);
          const respuesta: Response = await mod.GET(new Request(url));
          res.statusCode = respuesta.status;
          respuesta.headers.forEach((v, k) => res.setHeader(k, v));
          res.end(Buffer.from(await respuesta.arrayBuffer()));
        } catch (e) {
          res.statusCode = 500;
          res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiLocal()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/echarts') || id.includes('node_modules/zrender')) return 'echarts';
          if (id.includes('node_modules/leaflet')) return 'leaflet';
        },
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
    environment: 'node',
  },
});
