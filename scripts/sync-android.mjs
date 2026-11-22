import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/@capacitor/cli/bin/capacitor', import.meta.url))

execFileSync(process.execPath, [cli, 'sync', 'android'], {
  cwd: root,
  env: { ...process.env, LIMITLESS_ANDROID_APP: '1' },
  stdio: 'inherit',
})
