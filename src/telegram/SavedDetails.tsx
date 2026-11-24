import { useEffect, useRef, useState } from 'react'
import { Download, FileImage, FolderInput } from 'lucide-react'
import { DeviceFileActions, FileBadge, Modal, useObjectUrl } from '../components'
import { isAndroidApp } from '../android-device'
import { displaySize, fileKind, folderPaths, formatDate, formatSize, type Folder } from '../library'
import { describeFailure } from './connection'
import { downloadLimit, previewLimit, type ResumableDownload, type SavedFile, type SavedSession } from './saved-client'

const pausedDownload = new DOMException('Download paused', 'AbortError')

export function SavedThumbnail({ file, session }: { file: SavedFile; session: SavedSession }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [blob, setBlob] = useState<Blob>()
  const url = useObjectUrl(blob)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      void session.thumbnail(file, controller.signal).then((image) => {
        if (!controller.signal.aborted) setBlob(image)
      }).catch(() => {})
    }, { rootMargin: '80px' })
    if (anchor.current) observer.observe(anchor.current)
    return () => { observer.disconnect(); controller.abort() }
  }, [file.media, file.accountId, session]) // Album and favorite edits keep the same media.

  return <span ref={anchor} className="saved-thumb">
    {url && !failed ? <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
      : <FileImage size={28} aria-hidden="true" />}
  </span>
}

export function SavedDetails({ file, session, folders, sourceName, onMove, onTags, onClose, organizing, organizeError }: {
  file: SavedFile & { tags?: string[] }
  session: SavedSession
  folders: Folder[]
  sourceName: string
  onMove: (folderId: string | null) => void
  onTags: (tags: string) => void
  onClose: () => void
  organizing: boolean
  organizeError: string
}) {
  const transfer = useRef<AbortController | null>(null)
  const download = useRef<ResumableDownload | null>(null)
  const [blob, setBlob] = useState<Blob>()
  const [progress, setProgress] = useState<number>()
  const [active, setActive] = useState<'preview' | 'download'>()
  const [retainedBytes, setRetainedBytes] = useState(0)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(false)
  const url = useObjectUrl(blob)
  const kind = fileKind(file)
  const previewable = kind === 'image' || kind === 'video' || kind === 'pdf'

  useEffect(() => () => {
    download.current = null
    transfer.current?.abort()
  }, [])

  async function getFile(forPreview: boolean) {
    if (transfer.current) return
    const controller = new AbortController()
    transfer.current = controller
    setError('')
    setPaused(false)
    setActive(forPreview ? 'preview' : 'download')
    setProgress(undefined)
    try {
      const onProgress = (done: number, total: number) => {
        if (Number.isFinite(total) && total > 0) setProgress(Math.min(100, Math.floor(100 * done / total)))
        if (!forPreview) setRetainedBytes(download.current?.received ?? 0)
      }
      const content = forPreview
        ? await session.download(file, previewLimit, controller.signal, onProgress)
        : await (download.current ??= session.createDownload(file)).run(controller.signal, onProgress)
      if (!controller.signal.aborted) {
        download.current = null
        setRetainedBytes(0)
        setPreview(forPreview)
        setBlob(content)
      }
    } catch (reason) {
      if (controller.signal.aborted) {
        if (controller.signal.reason === pausedDownload) setPaused(true)
        else {
          download.current = null
          setError('Download cancelled.')
        }
      } else {
        setError(describeFailure(reason, 'Could not download this file. Try again.', 'production'))
      }
      setRetainedBytes(download.current?.received ?? 0)
    } finally {
      transfer.current = null
      setActive(undefined)
    }
  }

  return <Modal title={file.name} onClose={onClose} wide media={preview && (kind === 'image' || kind === 'video')}>
    {preview && url && kind === 'image' && <div className="media-stage"><img src={url} alt={file.name} /></div>}
    {preview && url && kind === 'video' && <div className="media-stage"><video src={url} controls playsInline aria-label={file.name} /></div>}
    <div className="dialog-body">
      {preview && url && kind === 'pdf' && <object className="pdf-preview" data={url} type="application/pdf" aria-label={file.name}>
        <p>PDF preview is unavailable. Save the file to open it locally.</p>
      </object>}
      <div className="detail-row"><FileBadge file={file} />
        <p className="file-meta">{sourceName} #{file.messageId} · {displaySize(file)} · {formatDate(file.addedAt)}</p>
      </div>
      <label className="move-control"><FolderInput size={17} aria-hidden="true" /> Album in Limitless
        <select disabled={organizing} value={file.folderId ?? ''} onChange={(event) => onMove(event.currentTarget.value || null)}>
          <option value="">No album</option>
          {[...folderPaths(folders)].map(([id, path]) => <option key={id} value={id}>{path}</option>)}
        </select>
      </label>
      <p className="file-meta">Album changes apply in Limitless. The Telegram message stays in its original chat.</p>
      <form className="saved-inline-form" onSubmit={(event) => {
        event.preventDefault()
        onTags(String(new FormData(event.currentTarget).get('tags') ?? ''))
      }}>
        <label>Tags<input key={file.tags?.join(',')} name="tags" defaultValue={file.tags?.join(', ')} placeholder="Separate tags with commas" disabled={organizing} /></label>
        <button className="button" disabled={organizing}>Save tags</button>
      </form>
      {active && <div className="saved-progress">
        <progress aria-label="Download progress" max={100} value={progress} />
        {active === 'download' && <button className="button" disabled={!retainedBytes}
          onClick={() => transfer.current?.abort(pausedDownload)}>Pause download</button>}
        <button className="button" onClick={() => transfer.current?.abort()}>Cancel download</button>
      </div>}
      {!active && retainedBytes > 0 && <div className="saved-actions">
        <p className="file-meta" role="status">{paused && 'Download paused. '}{formatSize(retainedBytes)} ready to resume.</p>
        <button className="button" onClick={() => {
          download.current = null
          setRetainedBytes(0)
          setPaused(false)
          setError('')
        }}>Discard partial download</button>
      </div>}
      {error && <p className="error" role="alert">{error}</p>}
      {organizeError && <p className="error" role="alert">{organizeError}</p>}
      <div className="dialog-actions">
        {file.source && <a className="button" href={`https://t.me/c/${file.source.channelId}/${file.messageId}`}
          target="_blank" rel="noreferrer">Open in Telegram</a>}
        {previewable && !preview && <button className="button" disabled={Boolean(active) || retainedBytes > 0 || (file.bytes ?? 0) > previewLimit} onClick={() => void getFile(true)}>Preview</button>}
        {isAndroidApp && blob ? <DeviceFileActions content={blob} name={file.name} />
          : url ? <a className="button primary" href={url} download={file.name}><Download size={17} /> Save file</a>
          : <button className="button primary" disabled={Boolean(active) || (file.bytes ?? 0) > downloadLimit} onClick={() => void getFile(false)}>
            <Download size={17} /> {retainedBytes > 0 && !active ? 'Resume download' : 'Download'}
          </button>}
      </div>
      {(file.bytes ?? 0) > downloadLimit && <p className="file-meta">This file is larger than 100 MiB. Download it in Telegram.</p>}
    </div>
  </Modal>
}
