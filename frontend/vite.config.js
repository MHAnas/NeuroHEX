import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        patient: resolve(__dirname, 'patient.html'),
        atlas: resolve(__dirname, 'atlas.html'),
        comparison: resolve(__dirname, 'comparison.html'),
        poster: resolve(__dirname, 'poster.html'),
      }
    }
  },
  server: {
    proxy: {
      '/api/papers': {
        target: 'https://api.semanticscholar.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/papers/, '/graph/v1/paper/search'),
      },
      '/segment': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/tumor': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    }
  }
})