import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const base = process.env.VITE_BASE_PATH ?? '/lunumi/';
const productionPath = base === '/lunumi/';
const require = createRequire(import.meta.url);
const onnxRuntimeDist = dirname(require.resolve('onnxruntime-web/webgpu'));

function bundleOnnxRuntimeAssets() {
  return {
    name: 'bundle-onnxruntime-webgpu-assets',
    generateBundle: {
      order: 'post' as const,
      handler(_options, bundle) {
        // The WebGPU runtime has its own import.meta.url fallback URL, which Vite
        // emits as a second copy. We set wasmPaths explicitly in the worker, so
        // that fallback asset is never requested.
        for (const fileName of Object.keys(bundle)) {
          if (/^assets\/ort-wasm-simd-threaded\.asyncify-[^/]+\.(mjs|wasm)$/.test(fileName)) {
            delete bundle[fileName];
          }
        }
        for (const file of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
          this.emitFile({ type: 'asset', fileName: `onnxruntime/${file}`, source: readFileSync(join(onnxRuntimeDist, file)) });
        }
      },
    },
  };
}

export default defineConfig({
  base,
  plugins: [
    react(),
    bundleOnnxRuntimeAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['lunumi.svg'],
      manifest: {
        name: 'Lunumi',
        short_name: 'Lunumi',
        description: 'Food, found nearby',
        theme_color: '#fff8f0',
        background_color: '#fff8f0',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [{ src: 'lunumi.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        navigateFallback: 'index.html',
        globIgnores: ['onnxruntime/**'],
        runtimeCaching: [{
          urlPattern: /\/data\/helsinki-metro\.json$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'lunumi-helsinki-data',
            networkTimeoutSeconds: 3,
            expiration: { maxEntries: 1, maxAgeSeconds: 14 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }, {
          urlPattern: /\/onnxruntime\/.*\.(?:mjs|wasm)$/i,
          handler: 'CacheFirst',
          options: {
            cacheName: 'lunumi-onnxruntime-v1',
            expiration: { maxEntries: 2, maxAgeSeconds: 30 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }, {
          urlPattern: /\/data\/restaurant-directory\.json$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'lunumi-restaurant-directory-v2',
            
            expiration: { maxEntries: 1, maxAgeSeconds: 14 * 24 * 60 * 60 },
            cacheableResponse: { statuses: [0, 200] },
          },
        }],
        navigateFallbackDenylist: [
          ...(productionPath ? [/^\/lunumi\/staging(?:\/|$)/] : []),
          /\/visit-animation-preview\.html$/,
        ],
      },
    }),
  ],
});
