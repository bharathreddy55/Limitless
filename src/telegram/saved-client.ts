import { InputMedia, Long, Photo, RawDocument, networkMiddlewares, tl, type Chat, type FileLocation, type Message } from '@mtcute/web'
import { createConnection, TelegramError } from './connection'
import { androidDevice, isAndroidApp } from '../android-device'
import type { RemoteDisplayFile } from '../library'
import type { TelegramChatAddress } from '../storage'
import { encryptedIndexCaption, encryptedIndexFilename, encryptedIndexSizeLimit } from './encrypted-index'

const PAGE_SIZE = 30
export const downloadLimit = 100 * 1024 * 1024
export const previewLimit = 16 * 1024 * 1024
const thumbnailLimit = 256 * 1024
const downloadPartKiB = 256
const downloadPartBytes = downloadPartKiB * 1024
export type HistoryOffset = { id: number; date: number }
export type UploadId = { low: number; high: number }
export type SavedFile = RemoteDisplayFile & {
  accountId: number
  messageId: number
  media: RawDocument | Photo
  source: TelegramChatAddress | null
}
type DownloadBuffer = { parts: Uint8Array<ArrayBuffer>[]; received: number }
export type ResumableDownload = {
  readonly received: number
  run(signal: AbortSignal, onProgress: (received: number, total: number) => void): Promise<Blob>
}

const emptyDownload = (): DownloadBuffer => ({ parts: [], received: 0 })

export function newUploadId(): UploadId {
  const [low, high] = crypto.getRandomValues(new Int32Array(2))
  return { low: low || (high ? 0 : 1), high }
}

export function isDuplicateUpload(error: unknown) {
  return tl.RpcError.is(error, 'RANDOM_ID_DUPLICATE')
}

function privateGroupPeer(chat: Chat): tl.RawInputPeerChannel | undefined {
  if (chat.raw._ !== 'channel' || !chat.raw.accessHash) return
  if (chat.chatType !== 'supergroup' || !chat.isCreator || chat.isMin || chat.username || chat.usernames?.some((name) => name.active)) return
  const peer = chat.inputPeer
  if (peer._ !== 'inputPeerChannel') return
  return peer
}

export function groupCreationRejected(error: unknown) {
  return tl.RpcError.is(error) && [400, 401, 403, 404, 406, 420].includes(error.code)
}

const groupDescription = (id: string) => `Limitless subgroup ${id}`

function isEncryptedIndexMessage(accountId: number, message: Message) {
  return message.chat.id === accountId && message.text === encryptedIndexCaption &&
    message.media instanceof RawDocument && message.media.fileName === encryptedIndexFilename
}

function savedFile(accountId: number, message: Message, source: TelegramChatAddress | null): SavedFile | undefined {
  const media = message.media
  if (message.chat.id !== (source?.chatId ?? accountId) || !(media instanceof Photo || media instanceof RawDocument)) return
  return {
    id: `telegram:${accountId}:${source ? `group:${source.chatId}` : 'self'}:${message.id}`,
    accountId,
    messageId: message.id,
    media,
    source,
    name: media instanceof Photo ? `Photo ${message.id}.jpg` : media.fileName || `Attachment ${message.id}`,
    mime: media instanceof Photo ? 'image/jpeg' : media.mimeType || 'application/octet-stream',
    bytes: media.fileSize,
    addedAt: message.date.getTime(),
    favorite: false,
    folderId: null,
  }
}

async function appTelegramConfig(): Promise<{ apiId: number; apiHash: string }> {
  if (isAndroidApp) {
    try {
      return await androidDevice.readConfig()
    } catch {
      throw new TelegramError('Android could not load the Telegram setup. Choose the setup file again.')
    }
  }
  const response = await fetch('/__limitless/telegram-config', {
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok || !response.headers.get('content-type')?.startsWith('application/json')) {
    throw new TelegramError('Telegram sign-in needs to be configured on this Limitless server.')
  }
  return response.json()
}

export async function createSavedSession() {
  const { apiId, apiHash } = await appTelegramConfig()
  const connection = createConnection('production', apiId, apiHash, {
    middlewares: [
      (ctx, next) => next({ ...ctx, params: {
        ...ctx.params,
        timeout: ctx.params?.timeout ?? 25000,
        abortSignal: ctx.params?.abortSignal ?? AbortSignal.timeout(25000),
        floodSleepThreshold: ctx.params?.floodSleepThreshold ?? 0,
        // Creating a group has no Telegram idempotency key.
        maxRetryCount: ctx.request._ === 'channels.createChannel' ? 0 : ctx.params?.maxRetryCount,
      } }),
      ...networkMiddlewares.basic(),
    ],
  })
  const { client } = connection
  const groupPeers = new Map<number, tl.RawInputPeerChannel>()

  function rememberGroup(chat: Chat, peer: tl.RawInputPeerChannel): TelegramChatAddress {
    groupPeers.set(chat.id, peer)
    return { chatId: chat.id, channelId: peer.channelId }
  }

  async function inputPeer(source: TelegramChatAddress | null): Promise<'self' | tl.RawInputPeerChannel> {
    if (!source) return 'self'
    const cached = groupPeers.get(source.chatId)
    if (cached) return cached
    // Access hashes belong to the current Telegram sign-in. Resolve the saved ID again after a new sign-in.
    for await (const { peer: chat } of client.iterDialogs({ archived: 'keep' })) {
      if (chat.type !== 'chat' || chat.raw._ !== 'channel' || chat.raw.id !== source.channelId) continue
      const peer = privateGroupPeer(chat)
      if (!peer || chat.id !== source.chatId) break
      rememberGroup(chat, peer)
      return peer
    }
    throw new TelegramError('This subgroup’s private chat is unavailable. Check the group in Telegram.')
  }

  function checkAccount(file: SavedFile) {
    if (file.accountId !== connection.accountId) throw new TelegramError('Reconnect the account that owns this file.')
  }

  async function downloadWithin(media: FileLocation, mime: string, limit: number, signal: AbortSignal,
    stallTimeout: number, onProgress?: (received: number, total: number) => void, checkpoint?: DownloadBuffer) {
    const buffer = checkpoint ?? emptyDownload()
    const size = media.fileSize
    if (size !== undefined && buffer.received) onProgress?.(buffer.received, size)
    if (size !== buffer.received) {
      const resume = checkpoint && { offset: buffer.received, partSize: downloadPartKiB }
      for await (const chunk of client.downloadAsIterable(media, { abortSignal: signal, stallTimeout, ...resume })) {
        if (signal.aborted) throw signal.reason
        const received = buffer.received + chunk.length
        if (received > limit) throw new TelegramError('This file exceeds the size limit for this action.')
        if (size !== undefined && (received > size || (checkpoint && chunk.length !== Math.min(downloadPartBytes, size - buffer.received)))) {
          throw new TelegramError('Telegram returned an incomplete file part. Try downloading again.')
        }
        buffer.parts.push(Uint8Array.from(chunk))
        buffer.received = received
        onProgress?.(received, size ?? Number.NaN)
      }
    }
    if (signal.aborted) throw signal.reason
    if (size !== undefined && size !== buffer.received) {
      throw new TelegramError('The download stopped before the complete file arrived. Try again.')
    }
    return new Blob(buffer.parts, { type: mime })
  }

  async function currentFile(file: SavedFile, signal: AbortSignal) {
    checkAccount(file)
    const [message] = await client.getMessages(await inputPeer(file.source), [file.messageId])
    if (signal.aborted) throw signal.reason
    return message ? savedFile(file.accountId, message, file.source) : undefined
  }

  async function sendDocument(file: File, id: UploadId, source: TelegramChatAddress | null, signal: AbortSignal,
    progressCallback?: (sent: number, total: number) => void, caption?: string) {
    return client.sendMedia(await inputPeer(source), InputMedia.document(file, {
      fileName: file.name,
      fileMime: file.type || 'application/octet-stream',
    }), { randomId: Long.fromBits(id.low, id.high), abortSignal: signal, progressCallback, caption })
  }

  return {
    requestCode: connection.requestCode,
    submitCode: connection.submitCode,
    submitPassword: connection.submitPassword,
    get accountId() { return connection.accountId },
    close: connection.close,
    reconnect: connection.reconnect,
    resume: connection.resume,
    exportSession: () => client.exportSession(),

    async createSubgroup(title: string, id: string) {
      const chat = await client.createSupergroup({ title, description: groupDescription(id) })
      const peer = privateGroupPeer(chat)
      if (!peer) throw new TelegramError('Telegram did not confirm a private group. Use Find created chat to check again.')
      return rememberGroup(chat, peer)
    },

    async findSubgroup(title: string, id: string) {
      for await (const { peer: chat } of client.iterDialogs({ archived: 'keep' })) {
        if (chat.type !== 'chat' || chat.displayName !== title) continue
        const peer = privateGroupPeer(chat)
        if (peer && (await client.getFullChat(peer)).bio === groupDescription(id)) return rememberGroup(chat, peer)
      }
    },

    async archiveSubgroup(source: TelegramChatAddress) {
      await client.archiveChats(await inputPeer(source))
    },

    async uploadEncryptedIndex(file: File, id: UploadId) {
      const message = await sendDocument(file, id, null, AbortSignal.timeout(120000), undefined, encryptedIndexCaption)
      if (!isEncryptedIndexMessage(connection.accountId, message)) {
        throw new TelegramError('Telegram did not confirm the encrypted backup in Saved Messages.')
      }
    },

    async latestEncryptedIndex() {
      const account = connection.accountId
      const recent = await client.getHistory('self', { limit: PAGE_SIZE })
      const stored = recent.find((message) => isEncryptedIndexMessage(account, message)) ??
        (await client.searchMessages({ chatId: 'self', query: encryptedIndexCaption, filter: { _: 'inputMessagesFilterDocument' }, limit: 100 }))
          .filter((message) => isEncryptedIndexMessage(account, message)).sort((a, b) => b.id - a.id)[0]
      if (!stored || !(stored.media instanceof RawDocument)) throw new TelegramError('No encrypted Limitless backup was found in Saved Messages.')
      const { media } = stored
      if (media.fileSize !== undefined && media.fileSize > encryptedIndexSizeLimit) throw new TelegramError('The encrypted backup exceeds the size limit.')
      return downloadWithin(media, 'application/octet-stream', encryptedIndexSizeLimit, AbortSignal.timeout(120000), 30000)
    },

    async page(offset?: HistoryOffset, source: TelegramChatAddress | null = null) {
      const account = connection.accountId
      const page = await client.getHistory(await inputPeer(source), { limit: PAGE_SIZE, offset })
      const files = page.flatMap((message) => {
        if (!source && isEncryptedIndexMessage(account, message)) return []
        const file = savedFile(account, message, source)
        return file ? [file] : []
      })
      return { files, next: page.length === PAGE_SIZE ? page.next : undefined }
    },

    async missingIndexedFiles(ids: number[], source: TelegramChatAddress | null) {
      if (!ids.length) return 0
      const peer = await inputPeer(source)
      const account = connection.accountId
      let missing = 0
      for (let start = 0; start < ids.length; start += 100) {
        const requested = ids.slice(start, start + 100)
        const messages = await client.getMessages(peer, requested)
        const found = new Set(messages.flatMap((message) => message && savedFile(account, message, source) ? [message.id] : []))
        missing += requested.filter((id) => !found.has(id)).length
      }
      return missing
    },

    async upload(file: File, id: UploadId, signal: AbortSignal, onProgress: (sent: number, total: number) => void, source: TelegramChatAddress | null = null) {
      const account = connection.accountId
      const message = await sendDocument(file, id, source, signal, onProgress)
      const confirmed = savedFile(account, message, source)
      if (!confirmed) throw new TelegramError('Telegram returned an unexpected message. Refresh the current chat before sending again.')
      return confirmed
    },

    async download(file: SavedFile, limit: number, signal: AbortSignal, onProgress: (received: number, total: number) => void) {
      const current = await currentFile(file, signal)
      if (!current) throw new TelegramError('This file is no longer available in the Telegram chat. Refresh the list.')
      if (current.bytes !== undefined && current.bytes > limit) {
        throw new TelegramError(`This action supports up to ${limit / 1048576} MiB. Open larger files in Telegram.`)
      }
      return downloadWithin(current.media, current.mime, limit, signal, 30000, onProgress)
    },

    createDownload(file: SavedFile): ResumableDownload {
      let buffer = emptyDownload()
      let version: string | undefined
      return {
        get received() { return buffer.received },
        async run(signal, onProgress) {
          const current = await currentFile(file, signal)
          if (!current) {
            buffer = emptyDownload()
            throw new TelegramError('This file is no longer available in the Telegram chat. Refresh the list.')
          }
          const { media, bytes } = current
          const nextVersion = `${media instanceof Photo ? 'photo' : 'document'}:${media.raw.id}:${bytes}`
          if (buffer.received && version !== nextVersion) {
            buffer = emptyDownload()
            throw new TelegramError('The Telegram attachment changed. The partial download was discarded. Refresh the list before downloading again.')
          }
          if (bytes !== undefined && bytes > downloadLimit) {
            throw new TelegramError('This action supports up to 100 MiB. Open larger files in Telegram.')
          }
          version = nextVersion
          // Only reuse full, aligned parts of an attachment with a known size.
          const content = await downloadWithin(media, current.mime, downloadLimit, signal, 30000, onProgress, bytes === undefined ? undefined : buffer)
          buffer = emptyDownload()
          return content
        },
      }
    },

    async thumbnail(file: SavedFile, signal: AbortSignal) {
      checkAccount(file)
      const preview = file.media.getThumbnail('m') ?? file.media.getThumbnail('b') ?? file.media.getThumbnail('s') ?? file.media.getThumbnail('i')
      if (!preview || (preview.fileSize !== undefined && preview.fileSize > thumbnailLimit)) return
      return downloadWithin(preview, 'image/jpeg', thumbnailLimit, signal, 8000)
    },
  }
}

export type SavedSession = Awaited<ReturnType<typeof createSavedSession>>
