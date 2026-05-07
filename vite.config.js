import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ⚠️ 极其重要：这里的名字必须与你 GitHub 仓库名的大小写一模一样
  // 从你截图看，应该用大写的 '/AI-Code-Showdown/' 
  base: '/AI-Code-Showdown/', 
  build: {
    outDir: 'docs', // 🚀 关键：让 Vite 把编译好的文件输出到 docs 文件夹
  }
})