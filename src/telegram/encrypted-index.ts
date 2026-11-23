import { TelegramError } from './connection'
import { indexBackupSizeLimit, openIndexBackup } from './index-backup'

export const encryptedIndexFilename = 'limitless-organization-v1.ltx'
export const encryptedIndexCaption = 'Limitless encrypted organization backup v1'
const encoder = new TextEncoder()
const header = encoder.encode('Limitless organization backup v1\n')
const saltSize = 16
const ivSize = 12
const tagSize = 16
const ciphertextStart = header.length + saltSize + ivSize
export const encryptedIndexSizeLimit = ciphertextStart + indexBackupSizeLimit + tagSize

export function checkBackupPassphrase(passphrase: string) {
  if (passphrase.trim().length < 12 || passphrase.length > 256) {
    throw new TelegramError('Use a backup passphrase between 12 and 256 characters.')
  }
  if (!globalThis.crypto?.subtle) throw new TelegramError('Encrypted backups require a secure Limitless connection.')
}

async function indexKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, purpose: 'encrypt' | 'decrypt') {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, hash: 'SHA-256', iterations: 600_000 },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [purpose],
  )
}

export async function encryptIndexBackup(backup: Blob, passphrase: string) {
  checkBackupPassphrase(passphrase)
  if (backup.size > indexBackupSizeLimit) throw new TelegramError('This backup exceeds the 16 MiB limit.')
  const salt = crypto.getRandomValues(new Uint8Array(saltSize))
  const iv = crypto.getRandomValues(new Uint8Array(ivSize))
  const key = await indexKey(passphrase, salt, 'encrypt')
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, await backup.arrayBuffer())
  return new File([header, salt, iv, encrypted], encryptedIndexFilename, { type: 'application/octet-stream' })
}

export async function openEncryptedIndex(backup: Blob, passphrase: string, accountId: number) {
  checkBackupPassphrase(passphrase)
  if (backup.size > encryptedIndexSizeLimit || backup.size <= ciphertextStart + tagSize) {
    throw new TelegramError('The encrypted backup has an invalid size.')
  }
  const bytes = new Uint8Array(await backup.arrayBuffer())
  if (!header.every((byte, index) => byte === bytes[index])) {
    throw new TelegramError('This encrypted backup format is unsupported.')
  }
  const salt = bytes.subarray(header.length, header.length + saltSize)
  const iv = bytes.subarray(header.length + saltSize, ciphertextStart)
  const key = await indexKey(passphrase, salt, 'decrypt')
  let decoded: ArrayBuffer
  try {
    decoded = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: header }, key, bytes.subarray(ciphertextStart))
  } catch {
    throw new TelegramError('Could not unlock the backup. Check the passphrase. A damaged backup will also fail this check.')
  }
  return openIndexBackup(new Blob([decoded]), accountId)
}
