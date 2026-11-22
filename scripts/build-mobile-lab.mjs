import { rename } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const input = fileURLToPath(new URL('../telegram-lab.html', import.meta.url))
const out = new URL('../dist-telegram-lab/', import.meta.url)

await build({
  root,
  mode: 'telegram-mobile-lab',
  publicDir: false,
  build: {
    outDir: fileURLToPath(out),
    rollupOptions: { input },
  },
})

await rename(new URL('telegram-lab.html', out), new URL('index.html', out))
