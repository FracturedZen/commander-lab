import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages: pass --base=/commander-lab/ at build time
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Commander Lab',
        short_name: 'CmdLab',
        description:
          'Offline-first Commander (EDH) tabletop, deck builder, and play lab.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        // Relative so it respects Vite `base` (e.g. /commander-lab/)
        start_url: './',
        scope: './',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2,png,webp}'],
        navigateFallback: 'index.html',
        // Never cache Scryfall API / bulk downloads via the service worker
        runtimeCaching: [
          {
            urlPattern: ({ url }) =>
              url.hostname === 'api.scryfall.com' ||
              url.hostname === 'data.scryfall.io' ||
              url.hostname.endsWith('.scryfall.io'),
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            // Phase WASM binary (~39 MB) — cache after first boot for offline reuse
            urlPattern: ({ url }) =>
              url.hostname === 'data.phase-rs.dev' &&
              url.pathname.includes('/wasm/'),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'phase-wasm',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Phase card-data meta only (tiny); full JSON stays in IndexedDB via adapter
            urlPattern: ({ url }) =>
              url.hostname === 'data.phase-rs.dev' &&
              url.pathname.endsWith('card-data-meta.json'),
            handler: 'StaleWhileRevalidate',
            method: 'GET',
            options: {
              cacheName: 'phase-meta',
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
        ],
        // Allow large WASM in precache patterns if ever vendored under public/
        maximumFileSizeToCacheInBytes: 50 * 1024 * 1024,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
