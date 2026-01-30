import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({ 
  plugins: [react()], 
  server: {
    port: 5173,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@icons': path.resolve(__dirname, 'src-tauri/icons')
    }
  },
  assetsInclude: ['src-tauri/icons/**']
})
