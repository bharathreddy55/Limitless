import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { readTelegramConfig } from '../server/telegram-config.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const config = readTelegramConfig(loadEnv('development', root, 'LIMITLESS_TELEGRAM_'))
if (!config) {
  throw new Error('Set LIMITLESS_TELEGRAM_API_ID and LIMITLESS_TELEGRAM_API_HASH in .env.local first.')
}

const directory = new URL('../.qa.local/', import.meta.url)
const file = new URL('limitless-android-setup.json', directory)
await mkdir(directory, { recursive: true })
await writeFile(file, JSON.stringify({ format: 'limitless-android-setup', version: 1, ...config }), { mode: 0o600 })
process.stdout.write(`Private Android setup file: ${fileURLToPath(file)}\n`)
