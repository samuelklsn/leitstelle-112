import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
) as { version: string };

/**
 * Strikte CSP wie unter Windows (ADR-0005). Die Mac-App liefert die Seite über das eigene Schema ls112://,
 * deshalb genügt 'self'; nach außen darf nichts (Regel 6).
 */
function cspMeta(): Plugin {
  return {
    name: 'ls112-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'" />`,
      ),
  };
}

/**
 * Baut die Leitstellen-Oberfläche aus `apps/ui` samt Sim-Worker für die 3D-Mac-App (ADR-0022).
 * Ziel ist WKWebView (WebKit) auf macOS 26.
 */
export default defineConfig({
  base: './',
  plugins: [react(), cspMeta()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: '../Resources/web',
    emptyOutDir: true,
    target: 'safari18',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 5175,
    strictPort: true,
    // Die Oberfläche und die Basisinhalte liegen außerhalb dieses Ordners.
    fs: { allow: ['../../..'] },
  },
});
