import { useState, type ReactNode } from 'react'
import { Film, Folder, Heart, ImageOff } from 'lucide-react'
import { FileBadge, useObjectUrl } from './components'
import { displaySize, fileKind, formatDate, type DisplayFile, type Folder as LibraryFolder, type LibraryFile } from './library'

function PhotoThumbnail({ file }: { file: LibraryFile }) {
  const url = useObjectUrl(file.content)
  const [failed, setFailed] = useState(false)
  return url && !failed
    ? <img src={url} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
    : <ImageOff size={24} aria-hidden="true" />
}

function dayStart(time: number) {
  const date = new Date(time)
  return date.setHours(0, 0, 0, 0)
}

const groupDate = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' })

export function MediaGallery<T extends DisplayFile>({ files, onOpen, onFavorite, renderThumbnail, busy, flat = false }: {
  files: T[]
  onOpen: (file: T) => void
  onFavorite: (file: T) => void
  renderThumbnail?: (file: T) => ReactNode
  busy: boolean
  flat?: boolean
}) {
  const groups = new Map<number, T[]>()
  for (const file of files) {
    const key = flat ? 0 : dayStart(file.addedAt)
    const group = groups.get(key)
    if (group) group.push(file)
    else groups.set(key, [file])
  }
  const today = dayStart(Date.now())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  return <div className="timeline">
    {[...groups].map(([date, group]) => {
      const relative = date === today ? 'Today' : date === yesterday.getTime() ? 'Yesterday' : ''
      return <section className="day-group" key={date}>
        {!flat && <div className="day-heading">
          <h2>{relative || formatDate(date)}</h2>
          {relative && <span>{groupDate.format(date)}</span>}
        </div>}
        <div className="media-grid">
          {group.map((file) => {
            const isVideo = fileKind(file) === 'video'
            return <article className={`media-tile${isVideo ? ' video-tile' : ''}`} key={file.id}>
              <button className="media-open" onClick={() => onOpen(file)} aria-label={`Open ${file.name}`} title={file.name}>
                {renderThumbnail ? renderThumbnail(file) : isVideo ? <Film size={32} aria-hidden="true" />
                  : 'content' in file ? <PhotoThumbnail file={file} /> : <ImageOff size={24} aria-hidden="true" />}
                <span className="tile-name">{file.name}</span>
              </button>
              <button className={`tile-favorite${file.favorite ? ' is-favorite' : ''}`}
                aria-label={`Favorite ${file.name}`} aria-pressed={file.favorite}
                disabled={busy} onClick={() => onFavorite(file)}>
                <Heart size={18} aria-hidden="true" />
              </button>
            </article>
          })}
        </div>
      </section>
    })}
  </div>
}

export function AlbumGrid({ folders, files, onOpen }: {
  folders: LibraryFolder[]
  files: LibraryFile[]
  onOpen: (folder: LibraryFolder) => void
}) {
  const covers = new Map<string, LibraryFile>()
  const counts = new Map<string, number>()
  for (const file of files) {
    if (!file.folderId) continue
    counts.set(file.folderId, (counts.get(file.folderId) ?? 0) + 1)
    const cover = covers.get(file.folderId)
    if (fileKind(file) === 'image' && (!cover || cover.addedAt < file.addedAt)) covers.set(file.folderId, file)
  }
  return <div className="album-grid">
    {folders.map((folder) => {
      const cover = covers.get(folder.id)
      const count = counts.get(folder.id) ?? 0
      return <button className="album" key={folder.id} onClick={() => onOpen(folder)}>
        <span className={`album-cover ${folder.color}`}>
          {cover ? <PhotoThumbnail key={cover.id} file={cover} /> : <Folder size={36} aria-hidden="true" />}
        </span>
        <strong>{folder.name}</strong>
        <span>{count} {count === 1 ? 'item' : 'items'}</span>
      </button>
    })}
  </div>
}

export function FileList<T extends DisplayFile>({ files, folders, onOpen, onFavorite, busy }: {
  files: T[]
  folders: LibraryFolder[]
  onOpen: (file: T) => void
  onFavorite: (file: T) => void
  busy: boolean
}) {
  const folderNames = new Map(folders.map((folder) => [folder.id, folder.name]))
  return <div className="file-list">
    <table>
      <thead><tr>
        <th scope="col">Name</th><th scope="col" className="col-folder">Album</th>
        <th scope="col" className="col-date">Date added</th><th scope="col" className="col-size">Size</th>
        <th scope="col" className="col-action"><span className="sr-only">Favorites</span></th>
      </tr></thead>
      <tbody>{files.map((file) => <tr key={file.id}>
        <td><button className="file-title" onClick={() => onOpen(file)}>
          <FileBadge file={file} />
          <span><strong>{file.name}</strong><small>{displaySize(file)}</small></span>
        </button></td>
        <td className="col-folder">{folderNames.get(file.folderId ?? '') ?? '—'}</td>
        <td className="col-date">{formatDate(file.addedAt)}</td>
        <td className="col-size">{displaySize(file)}</td>
        <td className="col-action"><button className={file.favorite ? 'icon-button is-favorite' : 'icon-button'}
          aria-label={`Favorite ${file.name}`} aria-pressed={file.favorite} disabled={busy}
          onClick={() => onFavorite(file)}><Heart size={18} aria-hidden="true" /></button></td>
      </tr>)}</tbody>
    </table>
  </div>
}
