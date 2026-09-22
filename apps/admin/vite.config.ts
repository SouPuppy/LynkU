import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const project = JSON.parse(readFileSync(new URL('../../config/project.json', import.meta.url), 'utf8')) as { cloudEnvironment: string }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  base: './',
  define: { __LYNKU_CLOUDBASE_ENV__: JSON.stringify(project.cloudEnvironment) },
})
