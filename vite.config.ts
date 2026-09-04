import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 两种产物：
//   npm run build         → dist/          部署 GitHub Pages（base 取仓库名）
//   npm run build:single  → single/守望天梯人生.html  单文件，直接发群里双击玩
const single = process.env.SINGLE === '1'

export default defineConfig({
  base: single ? './' : (process.env.PAGES_BASE ?? '/'),
  plugins: single ? [viteSingleFile()] : [],
  build: {
    outDir: single ? 'single' : 'dist',
    emptyOutDir: true,
  },
})
