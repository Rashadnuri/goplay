import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icons/*.png'],
      manifest: {
        name: 'GO PLAY',
        short_name: 'GO PLAY',
        description: 'Play. Think. Compete.',
        lang: 'az',
        start_url: '/',
        display: 'fullscreen',
        display_override: ['fullscreen', 'standalone'],
        orientation: 'portrait',
        background_color: '#f6f1e7',
        theme_color: '#1b2233',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // never cache API / realtime traffic
        runtimeCaching: [],
      },
    }),
  ],
  build: { rollupOptions: { output: { manualChunks(id: string) { if (id.includes('node_modules/@supabase')) return 'supabase'; if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler|@remix-run)\//.test(id)) return 'react'; return undefined; } } } },
  resolve: { alias: [{ find: 'npm:@supabase/supabase-js@2', replacement: new URL('./tests/db/fake-supabase.ts', import.meta.url).pathname }] },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts', 'ai-service/**/*.test.ts'],
    testTimeout: 60000,
  },
});
