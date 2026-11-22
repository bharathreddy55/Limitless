import { InputMedia } from '@mtcute/web'
import { createConnection, TelegramError as LabError, type TelegramEnvironment } from '../telegram/connection'
export { describeFailure, type TelegramEnvironment } from '../telegram/connection'
import { confirmPilotUpload, pilotFileSize, readPilotRecord, reservePilotUpload } from './pilot-record'

const CHAT = 'self'
const PREFIX = 'limitless-test-'
const PAGE_SIZE = 5
export const sampleSizes = [1024, 65536, 262144] as const
export type SampleSize = typeof sampleSizes[number]
export type HistoryOffset = { id: number; date: number }
export type TestFile = { id: number; name: string }
export type Upload = TestFile & { bytes: number; sha256: string }
async function checksum(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function generateFile(size: SampleSize, prefix: string) {
  const bytes = new Uint8Array(size)
  for (let position = 0; position < bytes.length; position += 65536) {
    crypto.getRandomValues(bytes.subarray(position, position + 65536))
  }
  return { bytes, sha256: await checksum(bytes.buffer), name: `${prefix}${crypto.randomUUID()}.bin` }
}

export function createSession(environment: TelegramEnvironment, apiId: number, apiHash: string) {
  const connection = createConnection(environment, apiId, apiHash)
  const { client, requestCode, submitCode, submitPassword, close } = connection
  const testMode = environment === 'test'

  function accountProof(name: string) {
    return checksum(new TextEncoder().encode(`${connection.accountId}:${name}`).buffer)
  }

  async function sendGenerated(file: Awaited<ReturnType<typeof generateFile>>) {
    const message = await client.sendMedia(CHAT, InputMedia.document(file.bytes, {
      fileName: file.name,
      fileMime: 'application/octet-stream',
    }), testMode ? undefined : { abortSignal: AbortSignal.timeout(30000) })
    return message.id
  }

  async function requireDocument(upload: Upload) {
    const [message] = await client.getMessages(CHAT, [upload.id])
    const document = message?.media
    if (document?.type !== 'document' || document.fileName !== upload.name || document.fileSize !== upload.bytes) {
      throw new LabError('Saved Messages did not return the expected file.')
    }
    return document
  }

  async function verifyDownload(upload: Upload) {
    const document = await requireDocument(upload)
    const downloaded = await client.downloadAsBuffer(document, testMode ? undefined : { abortSignal: AbortSignal.timeout(30000) })
    const actual = await checksum(Uint8Array.from(downloaded).buffer)
    if (actual !== upload.sha256) throw new LabError('The downloaded checksum differs from the original.')
    return actual
  }

  async function confirmedPilotFile(): Promise<Upload> {
    if (testMode) throw new LabError('The production pilot is closed.')
    const record = await readPilotRecord()
    if (!record || record.id === undefined) throw new LabError('The pilot has no confirmed upload to verify.')
    if (record.accountProof !== await accountProof(record.name)) {
      throw new LabError('Sign in to the same account that uploaded the pilot file.')
    }
    return { id: record.id, name: record.name, bytes: pilotFileSize, sha256: record.sha256 }
  }

  return {
    requestCode, submitCode, submitPassword, close,

    async history(offset?: HistoryOffset) {
      if (!testMode) throw new LabError('The production pilot only opens its generated file.')
      const page = await client.getHistory(CHAT, { limit: PAGE_SIZE, offset })
      const files = page.flatMap((message): TestFile[] => {
        const name = message.media?.type === 'document' ? message.media.fileName : null
        return name?.startsWith(PREFIX) ? [{ id: message.id, name }] : []
      })
      return { files, next: page.length === PAGE_SIZE ? page.next : undefined }
    },

    async upload(size: SampleSize): Promise<Upload> {
      if (!testMode) throw new LabError('Use the single-file production pilot.')
      const file = await generateFile(size, PREFIX)
      return { id: await sendGenerated(file), name: file.name, bytes: size, sha256: file.sha256 }
    },

    async verify(upload: Upload) {
      if (!testMode) throw new LabError('Use the single-file production pilot.')
      return verifyDownload(upload)
    },

    async uploadPilot() {
      if (testMode) throw new LabError('The production pilot is closed.')
      const file = await generateFile(pilotFileSize, 'limitless-pilot-')
      const record = { name: file.name, sha256: file.sha256, accountProof: await accountProof(file.name) }
      try {
        await reservePilotUpload(record)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'ConstraintError') {
          throw new LabError('This pilot has already used its one upload in this browser.')
        }
        throw new LabError('Could not reserve the one upload in browser storage. No file was sent.')
      }
      const id = await sendGenerated(file)
      await confirmPilotUpload({ ...record, id })
      return id
    },

    async verifyPilot() {
      return verifyDownload(await confirmedPilotFile())
    },

    async reconnect() {
      await connection.reconnect()
      if (!testMode) await requireDocument(await confirmedPilotFile())
    },
  }
}

export type Session = ReturnType<typeof createSession>
