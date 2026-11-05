import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': 'http://127.0.0.1:4001',
      '/health': 'http://127.0.0.1:4001',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})