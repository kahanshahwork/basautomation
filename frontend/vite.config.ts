import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api':      { target: 'http://localhost:5051', changeOrigin: true },
      '/parse':    { target: 'http://localhost:5051', changeOrigin: true },
      '/detect':   { target: 'http://localhost:5051', changeOrigin: true },
      '/parsers':  { target: 'http://localhost:5051', changeOrigin: true },
      '/pdf_page': { target: 'http://localhost:5051', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
  },
})
