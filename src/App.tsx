import { lazy, Suspense, useEffect, useRef, useState, type DragEvent } from 'react'
import { Album, ArrowLeft, ChevronDown, Files, HardDrive, Heart, Image, Images, Infinity, Plus, Search, Send, Settings as SettingsIcon, Upload, X } from 'lucide-react'
import { FileDetails, FolderForm, Settings } from './components'
import { AlbumGrid, FileList, MediaGallery } from './Gallery'
import { formatSize, isMedia, makeFolder, type Library, type LibraryFile, type Theme } from './library'
import { addFiles, addFolder, loadLibrary, putFile, putTheme, removeFile } from './storage'

const SavedMessages = lazy(() => import('./telegram/SavedMessages'))

const destinations = [
  { id: 'gallery', name: 'Gallery', icon: Images },
  { id: 'albums', name: 'Albums', icon: Album },
  { id: 'files', name: 'Files', icon: Files },
  { id: 'favorites', name: 'Favorites', icon: Heart },
] as const

const sortOptions = [
  { id: 'latest', label: 'Newest first' },
  { id: 'name', label: 'Name A–Z' },
  { id: 'size', label: 'Largest first' },
] as const

type Destination = typeof destinations[number]['id']
type Sort = typeof sortOptions[number]['id']
type Dialog = { kind: 'folder' | 'settings' } | { kind: 'file'; id: string }

const fileNameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const countLabel = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`

export function App() {
  const [library, setLibrary] = useState<Library | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [destination, setDestination] = useState<Destination>('gallery')
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('latest')
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showTelegram, setShowTelegram] = useState(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const pendingWrite = useRef(false)
  const theme = library?.theme ?? 'system'

  useEffect(() => {
    let active = true
    loadLibrary().then((value) => { if (active) setLibrary(value) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && !dialog && searchInput.current) {
        event.preventDefault()
        searchInput.current.focus()
        searchInput.current.select()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [dialog])

  async function save(work: () => Promise<void>, fallback: string) {
    if (pendingWrite.current) return
    pendingWrite.current = true
    setError('')
    setFeedback('')
    setBusy(true)
    try {
      await work()
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === 'QuotaExceededError'
        ? 'This browser is out of storage. Free up space, then try again.'
        : fallback)
    } finally {
      pendingWrite.current = false
      setBusy(false)
    }
  }

  function navigate(next: Destination, folder: string | null = null) {
    setDestination(next)
    setAlbumId(folder)
    setSearch('')
    setError('')
    setFeedback('')
  }

  function showDialog(next: Dialog) {
    setError('')
    setDialog(next)
  }

  function closeDialog() {
    setDialog(null)
    setError('')
  }

  function importFiles(selected: File[]) {
    if (!selected.length) return
    const addedAt = Date.now()
    const imports = selected.map((file): LibraryFile => ({
      id: crypto.randomUUID(), name: file.name, content: file, folderId: albumId, favorite: false, addedAt,
    }))
    void save(async () => {
      await addFiles(imports)
      setLibrary((current) => current && { ...current, files: [...imports, ...current.files] })
      if (!albumId) navigate(imports.every(isMedia) ? 'gallery' : 'files')
      else setSearch('')
      setFeedback(`Imported ${countLabel(imports.length, 'file')}.`)
    }, 'Could not import the selected files. Try again.')
  }

  function createFolder(name: string) {
    if (!library || !name) return
    if (library.folders.some((folder) => (folder.parentId ?? null) === albumId && fileNameOrder.compare(folder.name, name) === 0)) {
      setError('An album with that name already exists here.')
      return
    }
    const folder = makeFolder(name, library.folders.length, albumId)
    void save(async () => {
      await addFolder(folder)
      setLibrary((current) => current && { ...current, folders: [...current.folders, folder] })
      closeDialog()
      navigate('albums', folder.id)
    }, 'Could not create this album. Try again.')
  }

  function updateFile(file: LibraryFile) {
    void save(async () => {
      await putFile(file)
      setLibrary((current) => current && { ...current, files: current.files.map((item) => item.id === file.id ? file : item) })
    }, 'Could not update this file. Try again.')
  }

  function deleteFile(file: LibraryFile) {
    void save(async () => {
      await removeFile(file.id)
      setLibrary((current) => current && { ...current, files: current.files.filter((item) => item.id !== file.id) })
      closeDialog()
      setFeedback(`Removed ${file.name}.`)
    }, 'Could not remove this file. Try again.')
  }

  function changeTheme(next: Theme) {
    void save(async () => {
      await putTheme(next)
      setLibrary((current) => current && { ...current, theme: next })
    }, 'Could not save this theme. Try again.')
  }

  function hasFiles(event: DragEvent) {
    return event.dataTransfer.types.includes('Files')
  }

  if (!library) {
    return <main className="loading">
      <span className="brand-icon"><Infinity size={23} /></span>
      {loadError
        ? <><h1>Couldn’t open your library</h1><p>Check that browser storage is available, then reload.</p>
          <button className="button primary" onClick={() => window.location.reload()}>Reload library</button></>
        : <p role="status">Opening your library…</p>}
    </main>
  }

  const { files, folders } = library
  const term = search.trim().toLocaleLowerCase()
  const album = folders.find((folder) => folder.id === albumId)
  const parent = folders.find((folder) => folder.id === album?.parentId)
  const childAlbums = folders.filter((folder) => (folder.parentId ?? null) === albumId)
  const activeFile = dialog?.kind === 'file' ? files.find((file) => file.id === dialog.id) : undefined
  const albumIndex = !term && destination === 'albums' && !album
  const timelineView = !term && destination !== 'files'
  const title = term ? 'Search results' : album?.name ?? destinations.find(({ id }) => id === destination)?.name
  const visibleFiles = files.filter((file) => {
    if (term) return file.name.toLocaleLowerCase().includes(term)
    if (destination === 'gallery') return isMedia(file)
    if (destination === 'favorites') return file.favorite
    if (album) return file.folderId === album.id
    return true
  })
  visibleFiles.sort((a, b) => {
    if (!timelineView && sort === 'size') return b.content.size - a.content.size || fileNameOrder.compare(a.name, b.name)
    if (!timelineView && sort === 'name') return fileNameOrder.compare(a.name, b.name)
    return b.addedAt - a.addedAt || fileNameOrder.compare(a.name, b.name)
  })
  const showMedia = timelineView || Boolean(term)
  const media = showMedia ? visibleFiles.filter(isMedia) : []
  const documents = showMedia ? visibleFiles.filter((file) => !isMedia(file)) : visibleFiles
  const mediaIndex = activeFile ? media.findIndex((file) => file.id === activeFile.id) : -1
  const previous = mediaIndex > 0 ? media[mediaIndex - 1] : undefined
  const next = mediaIndex >= 0 ? media[mediaIndex + 1] : undefined
  const openFile = (file: LibraryFile) => showDialog({ kind: 'file', id: file.id })
  const favorite = (file: LibraryFile) => updateFile({ ...file, favorite: !file.favorite })
  const totalBytes = files.reduce((sum, file) => sum + file.content.size, 0)

  return (
    <>
    <div hidden={!showTelegram}>
      <Suspense fallback={<p className="loading" role="status">Opening Limitless…</p>}>
        <SavedMessages folders={folders} onBack={() => setShowTelegram(false)} onFoldersRestored={(added) => {
          setLibrary((current) => current && {
            ...current,
            folders: [...new Map([...current.folders, ...added].map((folder) => [folder.id, folder])).values()],
          })
        }} />
      </Suspense>
    </div>
    <div hidden={showTelegram}>
    <div className="shell" onDragEnter={(event) => {
      if (hasFiles(event)) { event.preventDefault(); dragDepth.current++; setDragging(!pendingWrite.current && !dialog) }
    }} onDragOver={(event) => {
      if (hasFiles(event)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = pendingWrite.current || dialog ? 'none' : 'copy'
      }
    }} onDragLeave={(event) => {
      if (!hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (!dragDepth.current) setDragging(false)
    }} onDrop={(event) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (!dialog) importFiles(Array.from(event.dataTransfer.files))
    }}>
      <header className="topbar">
        <button className="brand" onClick={() => navigate('gallery')}>
          <span className="brand-icon"><Infinity size={23} strokeWidth={2.3} aria-hidden="true" /></span>
          <span>Limitless</span>
        </button>
        <div className="search">
          <Search size={21} aria-hidden="true" />
          <input ref={searchInput} type="search" placeholder="Search your library" aria-label="Search your library"
            value={search} onChange={(event) => setSearch(event.target.value)} />
          {search
            ? <button className="icon-button" aria-label="Clear search" onClick={() => { setSearch(''); searchInput.current?.focus() }}><X size={17} /></button>
            : <kbd aria-hidden="true">Ctrl K</kbd>}
        </div>
        <div className="top-actions">
          <button className="button telegram-entry" aria-label="Saved Messages" onClick={() => setShowTelegram(true)}>
            <Send size={17} aria-hidden="true" /> <span>Telegram</span>
          </button>
          <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={17} /> Import</button>
          <button className="icon-button settings-button" aria-label="Settings" onClick={() => showDialog({ kind: 'settings' })}><SettingsIcon size={21} /></button>
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => {
            importFiles(Array.from(event.currentTarget.files ?? []))
            event.currentTarget.value = ''
          }} />
        </div>
      </header>
      <aside className="sidebar">
        <nav aria-label="Library navigation">
          {destinations.map(({ id, name, icon: Icon }) => (
            <button key={id} className="nav-link" aria-current={!term && destination === id ? 'page' : undefined} onClick={() => navigate(id)}>
              <Icon size={21} aria-hidden="true" /> <span>{name}</span>
            </button>
          ))}
        </nav>
        <div className="local-card"><HardDrive size={19} aria-hidden="true" />
          <div><strong>On this device</strong><span>{formatSize(totalBytes)} stored</span></div>
        </div>
      </aside>
      <main className="main">
        {album && !term && <button className="back-link" onClick={() => navigate('albums', parent?.id ?? null)}><ArrowLeft size={16} /> {parent?.name ?? 'All albums'}</button>}
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            <p>{albumIndex ? countLabel(childAlbums.length, 'album') : countLabel(visibleFiles.length, destination === 'gallery' && !term ? 'item' : 'file')}</p>
          </div>
          {albumIndex && <button className="button" onClick={() => showDialog({ kind: 'folder' })}><Plus size={18} /> New album</button>}
          {album && !term && <button className="button" onClick={() => showDialog({ kind: 'folder' })}><Plus size={18} /> New child album</button>}
          {!timelineView && <div className="sort-control">
            <select aria-label="Sort files" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
              {sortOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
            </select>
            <ChevronDown size={16} aria-hidden="true" />
          </div>}
        </div>

        {!dialog && error && <p role="alert" className="error banner">{error}</p>}
        <p role="status" className={feedback ? 'feedback' : 'sr-only'}>{feedback}</p>

        {childAlbums.length > 0 && !term && destination === 'albums' && <AlbumGrid folders={childAlbums} files={files} onOpen={(folder) => navigate('albums', folder.id)} />}
        {!albumIndex && (visibleFiles.length ? <>
          {media.length > 0 && <MediaGallery files={media} flat={Boolean(term) || destination === 'favorites'} busy={busy} onOpen={openFile} onFavorite={favorite} />}
          {documents.length > 0 && <section className="documents">
            {media.length > 0 && <h2>Other files</h2>}
            <FileList files={documents} folders={folders} busy={busy} onOpen={openFile} onFavorite={favorite} />
          </section>}
        </> : (
          <div className="empty">
            <span className="empty-icon">{term ? <Search size={27} /> : destination === 'favorites' ? <Heart size={27} /> : <Image size={27} />}</span>
            <h2>{term ? 'No matching files' : destination === 'favorites' ? 'No favorites yet' : album ? 'No files in this album' : destination === 'gallery' ? 'Your gallery is empty' : 'No files yet'}</h2>
            <p>{term ? 'Try a different filename.' : destination === 'favorites' ? 'Tap the heart on a file to keep it here.' : 'Drop files here or import them from your device.'}</p>
            {term ? <button className="button" onClick={() => setSearch('')}>Clear search</button>
              : destination !== 'favorites' && <button className="button primary" disabled={busy} onClick={() => fileInput.current?.click()}>Import files</button>}
          </div>
        ))}
      </main>

      {dragging && <div className="drop-overlay"><div><Upload size={32} /><strong>Drop files to import</strong><span>{album ? `Add to ${album.name}` : 'Add to your library'}</span></div></div>}
      {dialog?.kind === 'folder' && <FolderForm parentName={album?.name} busy={busy} error={error} onCreate={createFolder} onClose={closeDialog} />}
      {dialog?.kind === 'settings' && <Settings theme={theme} onTheme={changeTheme} onClose={closeDialog} busy={busy} error={error} />}
      {activeFile && <FileDetails key={activeFile.id} file={activeFile} folders={folders} busy={busy} error={error} onClose={closeDialog}
        onMove={(folderId) => updateFile({ ...activeFile, folderId })} onRemove={() => deleteFile(activeFile)}
        onFavorite={() => favorite(activeFile)} onPrevious={previous && (() => openFile(previous))} onNext={next && (() => openFile(next))} />}
    </div>
    </div>
    </>
  )
}
