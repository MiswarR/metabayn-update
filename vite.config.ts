import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({ 
  base: './',
  plugins: [react()], 
  server: {
    port: 5174,
    strictPort: true,
    host: '127.0.0.1',
  },
  resolve: {
    alias: {
      '@icons': path.resolve(__dirname, 'src-tauri/icons')
    }
  },
  assetsInclude: ['src-tauri/icons/**']
})
