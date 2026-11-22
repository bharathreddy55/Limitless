import { InputMedia, Long, Photo, RawDocument, networkMiddlewares, tl, type FileLocation, type Message } from '@mtcute/web'
import { createConnection, TelegramError } from './connection'
import type { RemoteDisplayFile } from '../library'

const CHAT = 'self'
const PAGE_SIZE = 30
export const downloadLimit = 100 * 1024 * 1024
export const previewLimit = 16 * 1024 * 1024
const thumbnailLimit = 256 * 1024
export type HistoryOffset = { id: number; date: number }
export type UploadId = { low: number; high: number }
export type SavedFile = RemoteDisplayFile & { accountId: number; messageId: number; media: RawDocument | Photo }

export function newUploadId(): UploadId {
  const [low, high] = crypto.getRandomValues(new Int32Array(2))
  return { low: low || (high ? 0 : 1), high }
}

export function isDuplicateUpload(error: unknown) {
  return tl.RpcError.is(error, 'RANDOM_ID_DUPLICATE')
}

function savedFile(accountId: number, message: Message): SavedFile | undefined {
  const media = message.media
  if (message.chat.id !== accountId || !(media instanceof Photo || media instanceof RawDocument)) return
  return {
    id: `telegram:${accountId}:self:${message.id}`,
    accountId,
    messageId: message.id,
    media,
    name: media instanceof Photo ? `Photo ${message.id}.jpg` : media.fileName || `Attachment ${message.id}`,
    mime: media instanceof Photo ? 'image/jpeg' : media.mimeType || 'application/octet-stream',
    bytes: media.fileSize,
    addedAt: message.date.getTime(),
    favorite: false,
    folderId: null,
  }
}

export function createSavedSession(apiId: number, apiHash: string) {
  const connection = createConnection('production', apiId, apiHash, {
    middlewares: [
      (ctx, next) => next({ ...ctx, params: {
        ...ctx.params,
        timeout: ctx.params?.timeout ?? 25000,
        abortSignal: ctx.params?.abortSignal ?? AbortSignal.timeout(25000),
        floodSleepThreshold: ctx.params?.floodSleepThreshold ?? 0,
      } }),
      ...networkMiddlewares.basic(),
    ],
  })
  const { client } = connection

  function checkAccount(file: SavedFile) {
    if (file.accountId !== connection.accountId) throw new TelegramError('Reconnect the account that owns this file.')
  }

  async function downloadWithin(media: FileLocation, mime: string, limit: number, signal: AbortSignal,
    stallTimeout: number, progressCallback?: (received: number, total: number) => void) {
    const parts: Uint8Array<ArrayBuffer>[] = []
    let received = 0
    // Telegram's partial-download limit has alignment constraints. Bound the iterator instead.
    for await (const chunk of client.downloadAsIterable(media, { abortSignal: signal, stallTimeout, progressCallback })) {
      received += chunk.length
      if (received > limit) throw new TelegramError('This file exceeds the size limit for this action.')
      parts.push(Uint8Array.from(chunk))
    }
    if (signal.aborted) throw signal.reason
    if (media.fileSize !== undefined && media.fileSize !== received) {
      throw new TelegramError('The download stopped before the complete file arrived. Try again.')
    }
    return new Blob(parts, { type: mime })
  }

  return {
    requestCode: connection.requestCode,
    submitCode: connection.submitCode,
    submitPassword: connection.submitPassword,
    get accountId() { return connection.accountId },
    close: connection.close,
    reconnect: connection.reconnect,

    async page(offset?: HistoryOffset) {
      const account = connection.accountId
      const page = await client.getHistory(CHAT, { limit: PAGE_SIZE, offset })
      const files = page.flatMap((message) => {
        const file = savedFile(account, message)
        return file ? [file] : []
      })
      return { files, next: page.length === PAGE_SIZE ? page.next : undefined }
    },

    async upload(file: File, id: UploadId, signal: AbortSignal, onProgress: (sent: number, total: number) => void) {
      const account = connection.accountId
      const message = await client.sendMedia(CHAT, InputMedia.document(file, {
        fileName: file.name,
        fileMime: file.type || 'application/octet-stream',
      }), {
        randomId: Long.fromBits(id.low, id.high),
        abortSignal: signal,
        progressCallback: onProgress,
      })
      const confirmed = savedFile(account, message)
      if (!confirmed) throw new TelegramError('Telegram returned an unexpected message. Refresh Saved Messages before sending again.')
      return confirmed
    },

    async download(file: SavedFile, limit: number, signal: AbortSignal, onProgress: (received: number, total: number) => void) {
      checkAccount(file)
      const [message] = await client.getMessages(CHAT, [file.messageId])
      if (signal.aborted) throw signal.reason
      const current = message && savedFile(file.accountId, message)
      if (!current) throw new TelegramError('This file is no longer in Saved Messages. Refresh the list.')
      if (current.bytes !== undefined && current.bytes > limit) {
        throw new TelegramError(`This action supports up to ${limit / 1048576} MiB. Open larger files in Telegram.`)
      }
      return downloadWithin(current.media, current.mime, limit, signal, 30000, onProgress)
    },

    async thumbnail(file: SavedFile, signal: AbortSignal) {
      checkAccount(file)
      const preview = file.media.getThumbnail('m') ?? file.media.getThumbnail('b') ?? file.media.getThumbnail('s') ?? file.media.getThumbnail('i')
      if (!preview || (preview.fileSize !== undefined && preview.fileSize > thumbnailLimit)) return
      return downloadWithin(preview, 'image/jpeg', thumbnailLimit, signal, 8000)
    },
  }
}

export type SavedSession = ReturnType<typeof createSavedSession>
