import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { presetUno, presetAttributify, presetIcons } from 'unocss'
import transformerDirective from '@unocss/transformer-directives'

const rendererRoot = resolve(__dirname, 'src/renderer')

export default defineConfig({
  root: rendererRoot,
  base: '/',
  publicDir: false,
  resolve: {
    alias: {
      '@renderer': resolve(rendererRoot, 'src')
    }
  },
  plugins: [
    vue(),
    UnoCSS({
      presets: [presetUno(), presetAttributify(), presetIcons()],
      transformers: [transformerDirective()]
    })
  ],
  build: {
    outDir: resolve(__dirname, 'out/web-renderer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      input: {
        index: resolve(rendererRoot, 'web.html')
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]'
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.WEB_SERVER_URL ?? 'http://localhost:3210',
        changeOrigin: true
      }
    }
  }
})