import type { Folder } from '../library'
import { telegramMessageLocation, type TelegramIndexData, type TelegramMetadata, type TelegramSubgroup } from '../storage'
import { TelegramError } from './connection'

const format = 'limitless-telegram-index'
const version = 1
export const indexBackupSizeLimit = 16 * 1024 * 1024
const idPattern = /^[a-z0-9_-]{1,128}$/i

function invalid(): never {
  throw new TelegramError('This file is not a valid Limitless backup.')
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}

function nonempty(value: unknown, length: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > length) return invalid()
  return value
}

function id(value: unknown) {
  if (typeof value !== 'string' || !idPattern.test(value)) return invalid()
  return value
}

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) return invalid()
  return value
}

export function parseTags(value: string) {
  const tags = [...new Set(value.split(',').map((tag) => tag.trim().normalize('NFC').toLowerCase()).filter(Boolean))]
  if (tags.length > 20 || tags.some((tag) => tag.length > 32)) {
    throw new TelegramError('Use up to 20 tags, with a maximum of 32 characters per tag.')
  }
  return tags
}

function foldersInParentOrder(folders: Folder[]) {
  const lookup = new Map(folders.map((folder) => [folder.id, folder]))
  if (lookup.size !== folders.length) return invalid()
  const ordered = new Map<string, Folder>()
  for (const folder of folders) {
    const pending = new Map<string, Folder>()
    let current = folder
    while (!ordered.has(current.id)) {
      if (pending.has(current.id)) return invalid()
      pending.set(current.id, current)
      if (!current.parentId) break
      const parent = lookup.get(current.parentId)
      if (!parent) return invalid()
      current = parent
    }
    for (const entry of [...pending.values()].reverse()) ordered.set(entry.id, entry)
  }
  return ordered
}

function readIndex(value: unknown, accountId: number): TelegramIndexData {
  const input = record(value)
  if (input.format !== format) return invalid()
  if (input.version !== version) throw new TelegramError('This Limitless backup version is unsupported.')
  if (input.accountId !== accountId) throw new TelegramError('This backup belongs to a different Telegram account.')
  const folders = foldersInParentOrder(list(input.folders).map((item) => {
    const folder = record(item)
    const color = folder.color
    if (color !== 'mint' && color !== 'blue' && color !== 'peach') return invalid()
    return { id: id(folder.id), name: nonempty(folder.name, 64), color, parentId: folder.parentId == null ? null : id(folder.parentId) }
  }))

  function folderId(value: unknown) {
    const key = id(value)
    if (!folders.has(key)) return invalid()
    return key
  }

  const groupIds = new Set<string>()
  const chatIds = new Set<number>()
  const subgroups = list(input.subgroups).map((item): TelegramSubgroup => {
    const group = record(item)
    const base = { id: id(group.id), albumId: folderId(group.albumId), name: nonempty(group.name, 60) }
    if (groupIds.has(base.id)) return invalid()
    groupIds.add(base.id)
    if (group.state === 'draft') return { ...base, state: 'draft' }
    const title = nonempty(group.title, 256)
    if (group.state === 'pending') return { ...base, state: 'pending', title }
    if (group.state !== 'archived' && group.state !== 'created') return invalid()
    const { chatId, channelId } = record(group.peer)
    if (typeof channelId !== 'number' || !Number.isSafeInteger(channelId) || channelId <= 0 || typeof chatId !== 'number'
      || !Number.isSafeInteger(chatId) || chatId !== -1_000_000_000_000 - channelId || chatIds.has(chatId)) return invalid()
    chatIds.add(chatId)
    return { ...base, state: group.state, title, peer: { chatId, channelId } }
  })

  const fileIds = new Set<string>()
  const metadata = list(input.metadata).map((item): TelegramMetadata => {
    const file = record(item)
    const key = nonempty(file.id, 128)
    const location = telegramMessageLocation(accountId, key)
    if (!location || (location.chatId !== null && !chatIds.has(location.chatId)) || fileIds.has(key) || typeof file.favorite !== 'boolean') return invalid()
    fileIds.add(key)
    const tags = file.tags === undefined ? [] : list(file.tags).map((tag) => nonempty(tag, 32))
    if (tags.length > 20 || tags.some((tag) => tag.includes(','))) return invalid()
    return { id: key, folderId: file.folderId === null ? null : folderId(file.folderId), favorite: file.favorite, tags: parseTags(tags.join(',')) }
  })

  return { folders: [...folders.values()], subgroups, metadata }
}

export function createIndexBackup(accountId: number, data: TelegramIndexData) {
  const folders = new Map(data.folders.map((folder) => [folder.id, folder]))
  const included = new Map<string, Folder>()
  for (const folderId of [...data.metadata.map((file) => file.folderId), ...data.subgroups.map((group) => group.albumId)]) {
    let current = folders.get(folderId ?? '')
    while (current && !included.has(current.id)) {
      included.set(current.id, current)
      current = folders.get(current.parentId ?? '')
    }
  }
  const header = { format, version, accountId }
  // Reading our export through the same schema keeps extra fields out and guarantees it can be restored.
  const contents = readIndex({ ...data, ...header, folders: [...included.values()] }, accountId)
  const blob = new Blob([JSON.stringify({ ...header, ...contents }, null, 2)], { type: 'application/json' })
  if (blob.size > indexBackupSizeLimit) throw new TelegramError('This backup exceeds the 16 MiB limit.')
  return blob
}

export async function openIndexBackup(file: Blob, accountId: number) {
  if (file.size > indexBackupSizeLimit) throw new TelegramError('This backup exceeds the 16 MiB limit.')
  const text = await file.text()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return invalid()
  }
  return readIndex(value, accountId)
}
