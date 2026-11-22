import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    entries: ['index.html', 'telegram-lab.html', 'telegram-pilot.html'],
    exclude: ['@mtcute/wasm'],
  },
})
