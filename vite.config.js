import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site path must match the repository name exactly.
  base: '/vibe-coding-top20/',
  build: {
    outDir: 'docs',
  }
})
