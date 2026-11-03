import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Em desenvolvimento o `@vitejs/plugin-react` injeta o preâmbulo do React
 * Refresh como script inline, e o HMR usa WebSocket. A CSP do `index.html` é a
 * de produção (sem inline); este plugin troca a política só no dev server para
 * que a interface também carregue no navegador e no Electron de desenvolvimento.
 */
const DEV_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; " +
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*; " +
  "worker-src 'self' blob:; object-src 'none'; base-uri 'none'";

function devCsp(): import('vite').Plugin {
  return {
    name: 'prisma-vocal:dev-csp',
    apply: 'serve',
    transformIndexHtml(html: string): string {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        `$1${DEV_CSP}$2`,
      );
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), devCsp()],
  resolve: {
    alias: {
      '@core': r('./src/core'),
      '@shared': r('./src/shared'),
      '@audio': r('./src/audio'),
      '@renderer': r('./src/renderer'),
    },
  },
  server: {
    port: 5273,
    strictPort: true,
    host: '0.0.0.0',
    // The sandbox preview is proxied from a different host; allow it.
    allowedHosts: true,
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    // O AudioWorklet precisa ser um arquivo real: a CSP bloqueia `data:`.
    assetsInlineLimit: (filePath: string) =>
      filePath.endsWith('capture-processor.js') ? false : undefined,
  },
});
