import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api/papers': {
        target: 'https://api.semanticscholar.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/papers/, '/graph/v1/paper/search'),
      },
      // Add this — proxies /segment and /tumor to your FastAPI backend
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