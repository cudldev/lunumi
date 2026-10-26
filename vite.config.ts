import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE_PATH ?? '/lunumi/';
const productionPath = base === '/lunumi/';

export default defineConfig({
  base,
  plugins: [
    react(),
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
          urlPattern: /\/data\/restaurant-directory\.json$/,
          handler: 'NetworkFirst',
          options: {
            cacheName: 'lunumi-restaurant-directory',
            networkTimeoutSeconds: 3,
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
