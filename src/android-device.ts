import { Capacitor, registerPlugin } from '@capacitor/core'

type TelegramConfig = { apiId: number; apiHash: string }
export type AndroidStatus = { configured: boolean; savedSession: boolean }

interface LimitlessDevice {
  status(): Promise<AndroidStatus>
  configure(config: TelegramConfig): Promise<void>
  readConfig(): Promise<TelegramConfig>
  readSession(): Promise<{ session?: string }>
  saveSession(options: { session: string }): Promise<void>
  clearSession(): Promise<void>
  beginFile(options: { name: string; mime: string; size: string }): Promise<{ key: string }>
  appendFile(options: { key: string; data: string }): Promise<void>
  saveFile(options: { key: string }): Promise<{ saved: boolean; location: string }>
  shareFile(options: { key: string }): Promise<void>
  discardFile(options: { key: string }): Promise<void>
}

export const isAndroidApp = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
export const androidDevice = registerPlugin<LimitlessDevice>('LimitlessDevice')

export async function importAndroidSetup(file: File) {
  if (file.size > 4096) throw new Error('Choose the Limitless Android setup file.')
  let data: (TelegramConfig & { format: string; version: number }) | undefined
  try { data = JSON.parse(await file.text()) } catch { /* The file is checked below. */ }
  if (data?.format !== 'limitless-android-setup' || data.version !== 1 || !Number.isInteger(data.apiId)
    || data.apiId < 1 || data.apiId > 2_147_483_647 || typeof data.apiHash !== 'string' || !/^[a-f\d]{32}$/i.test(data.apiHash)) {
    throw new Error('Choose the Limitless Android setup file.')
  }
  await androidDevice.configure({ apiId: data.apiId, apiHash: data.apiHash })
}

function encodeChunk(bytes: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(binary)
}

export async function exportAndroidFile(file: Blob, name: string, action: 'save' | 'share') {
  const { key } = await androidDevice.beginFile({ name, mime: file.type, size: String(file.size) })
  try {
    const chunkBytes = 256 * 1024
    for (let start = 0; start < file.size; start += chunkBytes) {
      const bytes = new Uint8Array(await file.slice(start, start + chunkBytes).arrayBuffer())
      await androidDevice.appendFile({ key, data: encodeChunk(bytes) })
    }
    if (action === 'share') {
      await androidDevice.shareFile({ key })
      return 'Share sheet opened.'
    }
    const result = await androidDevice.saveFile({ key })
    return result.saved ? `Saved to ${result.location}.` : 'Save cancelled.'
  } finally {
    await androidDevice.discardFile({ key }).catch(() => {})
  }
}
