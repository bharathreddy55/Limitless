import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Archive, ChevronLeft, ChevronRight, Download, File, FileImage, FileSpreadsheet, FileText, Film, FolderInput, Heart, Moon, Sun, Monitor, Trash2, X } from 'lucide-react'
import { fileKind, folderPaths, formatDate, formatSize, type DisplayFile, type Folder, type LibraryFile, type Theme } from './library'

const fileIcons = { image: FileImage, video: Film, pdf: FileText, sheet: FileSpreadsheet, text: FileText, other: File }

export function useObjectUrl(blob: Blob | undefined) {
  const [entry, setEntry] = useState<{ blob: Blob; url: string }>()
  useEffect(() => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    setEntry({ blob, url })
    return () => URL.revokeObjectURL(url)
  }, [blob])
  return entry && entry.blob === blob ? entry.url : undefined
}

export function FileBadge({ file }: { file: DisplayFile }) {
  const kind = fileKind(file)
  const Icon = fileIcons[kind]
  return <span className={`file-badge ${kind}`}><Icon size={19} aria-hidden="true" /></span>
}

export function Modal({ title, children, onClose, wide = false, media = false, onKeyDown }: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
  media?: boolean
  onKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    dialog.querySelector<HTMLElement>('[data-initial-focus]')?.focus()
    return () => dialog.close()
  }, [])
  return (
    <dialog ref={ref} className={`dialog${wide ? ' wide' : ''}${media ? ' media-dialog' : ''}`} aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header className="dialog-header">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" type="button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button>
      </header>
      {children}
    </dialog>
  )
}

export function FolderForm({ busy, error, onCreate, onClose, parentName }: {
  busy: boolean
  error: string
  onCreate: (name: string) => void
  onClose: () => void
  parentName?: string
}) {
  const [name, setName] = useState('')
  const fieldId = useId()
  return (
    <Modal title={parentName ? `New album in ${parentName}` : 'New album'} onClose={onClose}>
      <form className="dialog-body" onSubmit={(event) => { event.preventDefault(); onCreate(name.trim()) }}>
        <label htmlFor={fieldId}>Album name</label>
        <input data-initial-focus id={fieldId} value={name} placeholder="e.g. Photos" maxLength={64}
          onChange={(event) => setName(event.target.value)} />
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions">
          <button className="button" type="button" onClick={onClose}>Cancel</button>
          <button className="button primary" disabled={!name.trim() || busy}>Create album</button>
        </div>
      </form>
    </Modal>
  )
}

const themeOptions = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
] as const

export function Settings({ theme, onTheme, onClose, busy, error }: {
  theme: Theme
  onTheme: (theme: Theme) => void
  onClose: () => void
  busy: boolean
  error: string
}) {
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="dialog-body">
        <fieldset className="theme-choices" disabled={busy}>
          <legend>Appearance</legend>
          {themeOptions.map(({ id, label, icon: Icon }) => (
            <label key={id}>
              <input type="radio" name="theme" value={id} checked={theme === id} onChange={() => onTheme(id)} />
              <Icon size={19} aria-hidden="true" />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="settings-storage">
          <Archive size={20} aria-hidden="true" />
          <div><strong>Local storage</strong><p>Files and preferences are saved in this browser. Clearing site data removes this library.</p></div>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </Modal>
  )
}

export function FileDetails({ file, folders, onMove, onRemove, onClose, onFavorite, onPrevious, onNext, busy, error }: {
  file: LibraryFile
  folders: Folder[]
  onMove: (folderId: string | null) => void
  onRemove: () => void
  onClose: () => void
  onFavorite: () => void
  onPrevious?: () => void
  onNext?: () => void
  busy: boolean
  error: string
}) {
  const url = useObjectUrl(file.content)
  const [confirm, setConfirm] = useState(false)
  const [mediaFailed, setMediaFailed] = useState(false)
  const folderField = useId()
  const kind = fileKind(file)
  const media = kind === 'image' || kind === 'video'

  function browse(event: KeyboardEvent<HTMLDialogElement>) {
    if (confirm || (event.target instanceof HTMLElement && event.target.closest('input, select, video'))) return
    const open = event.key === 'ArrowLeft' ? onPrevious : event.key === 'ArrowRight' ? onNext : undefined
    if (open) {
      event.preventDefault()
      open()
    }
  }

  return (
    <Modal title={file.name} onClose={onClose} wide media={media} onKeyDown={browse}>
      {media && <div className="media-stage">
        {url && !mediaFailed && kind === 'image' && <img src={url} alt={file.name} onError={() => setMediaFailed(true)} />}
        {url && !mediaFailed && kind === 'video' && <video src={url} controls playsInline preload="metadata"
          aria-label={file.name} onError={() => setMediaFailed(true)} />}
        {mediaFailed && <p>Preview unavailable. Download this file to open it.</p>}
        {onPrevious && <button className="viewer-arrow previous" aria-label="Previous item" onClick={onPrevious}><ChevronLeft size={24} /></button>}
        {onNext && <button className="viewer-arrow next" aria-label="Next item" onClick={onNext}><ChevronRight size={24} /></button>}
      </div>}
      <div className="dialog-body">
        {url && kind === 'pdf' && (
          <object className="pdf-preview" data={url} type="application/pdf" aria-label={`Preview of ${file.name}`}>
            <p>PDF preview is unavailable in this browser. Use Download to open the file.</p>
          </object>
        )}
        {!media && kind !== 'pdf' && (
          <div className="preview unavailable"><FileBadge file={file} /><span>Download this file to open it.</span></div>
        )}
        <div className="detail-row">
          <p className="file-meta">{formatSize(file.content.size)} <span>·</span> Added {formatDate(file.addedAt)}</p>
          <div className="move-control">
            <label htmlFor={folderField}><FolderInput size={17} /> Album</label>
            <select id={folderField} value={file.folderId ?? ''} disabled={busy} onChange={(event) => onMove(event.target.value || null)}>
              <option value="">Unfiled</option>
              {[...folderPaths(folders)].map(([id, path]) => <option key={id} value={id}>{path}</option>)}
            </select>
          </div>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="dialog-actions file-actions">
          {confirm ? (
            <>
              <span className="remove-text">Remove this file from your library?</span>
              <button className="button" onClick={() => setConfirm(false)} disabled={busy}>Cancel</button>
              <button className="button danger" onClick={onRemove} disabled={busy}>Remove file</button>
            </>
          ) : (
            <>
              <button className="button quiet" onClick={() => setConfirm(true)} disabled={busy}><Trash2 size={17} /> Remove</button>
              <button className={file.favorite ? 'button is-favorite' : 'button'} onClick={onFavorite}
                aria-pressed={file.favorite} disabled={busy}><Heart size={17} /> Favorite</button>
              {url && <a className="button primary" href={url} download={file.name}><Download size={17} /> Download</a>}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
