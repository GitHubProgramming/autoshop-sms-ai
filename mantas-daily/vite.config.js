import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/mantas-daily/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Mantas Daily',
        short_name: 'Daily',
        description: 'Dienos planas ir progresas',
        theme_color: '#2B4D3F',
        background_color: '#F7F5F2',
        display: 'standalone',
        start_url: '/mantas-daily/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
})
