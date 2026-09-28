import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import typegpu from 'unplugin-typegpu/vite'

const lucaDevPort = Number(process.env.LUCA_DEV_PORT ?? 41733)

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'render-worker': resolve('src/main/render-worker.ts')
        }
      }
    },
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    resolve: {
      alias: {
        // `@/` is the alias components.json gives shadcn registry components
        '@': resolve('src/renderer'),
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [
      // compiles the orbs' 'use gpu' functions to WGSL at build time
      typegpu({ include: [/\/components\/orbs\/.+\.ts$/, /\/lib\/shader\.ts$/] }),
      react(),
      tailwindcss()
    ],
    server: {
      // Dev only: the UI is served by Vite, project files and the token cookie come from the Luca server.
      proxy: {
        '/p': { target: `http://127.0.0.1:${lucaDevPort}`, changeOrigin: false },
        '/api': { target: `http://127.0.0.1:${lucaDevPort}`, changeOrigin: false },
        '/hf': { target: `http://127.0.0.1:${lucaDevPort}`, changeOrigin: false },
        '/fonts': { target: `http://127.0.0.1:${lucaDevPort}`, changeOrigin: false },
        '/luts': { target: `http://127.0.0.1:${lucaDevPort}`, changeOrigin: false }
      }
    }
  }
})
