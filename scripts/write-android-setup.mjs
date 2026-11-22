import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = loadEnv('development', root, 'LIMITLESS_TELEGRAM_')
const apiId = Number(env.LIMITLESS_TELEGRAM_API_ID)
const apiHash = env.LIMITLESS_TELEGRAM_API_HASH?.trim()
if (!Number.isInteger(apiId) || apiId <= 0 || apiId > 2_147_483_647 || !/^[a-f\d]{32}$/i.test(apiHash ?? '')) {
  throw new Error('Set LIMITLESS_TELEGRAM_API_ID and LIMITLESS_TELEGRAM_API_HASH in .env.local first.')
}

const directory = new URL('../.qa.local/', import.meta.url)
const file = new URL('limitless-android-setup.json', directory)
await mkdir(directory, { recursive: true })
await writeFile(file, JSON.stringify({ format: 'limitless-android-setup', version: 1, apiId, apiHash }), { mode: 0o600 })
process.stdout.write(`Private Android setup file: ${fileURLToPath(file)}\n`)
