import { useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, FileUp, Images, RefreshCw, Send } from 'lucide-react'
import { FileList, MediaGallery } from '../Gallery'
import { formatSize, isMedia, type Folder } from '../library'
import { addTelegramSubgroup, readTelegramMetadata, readTelegramSubgroups, patchTelegramMetadata, type TelegramMetadata, type TelegramSubgroup } from '../storage'
import { describeFailure, TelegramError } from './connection'
import { createSavedSession, isDuplicateUpload, newUploadId, type HistoryOffset, type SavedFile, type SavedSession, type UploadId } from './saved-client'
import { SavedDetails, SavedThumbnail } from './SavedDetails'
import { SubgroupSettings } from './SubgroupSettings'
import { setUpSubgroup } from './subgroups'
import './saved.css'

type Challenge =
  | { kind: 'code'; delivery: 'app' | 'sms' | 'call' | 'email' }
  | { kind: 'password' }
type Job = {
  file: File
  id: UploadId
  state: 'ready' | 'sending' | 'failed' | 'cancelled' | 'confirmed' | 'uncertain'
  progress: number
}

const deliveries = { app: 'your signed-in Telegram app', sms: 'SMS', call: 'a phone call', email: 'email' }
const rpcFailure = (reason: unknown, fallback: string) => describeFailure(reason, fallback, 'production')
const subgroupFailure = 'Could not finish subgroup setup. If the subgroup was added, use the action next to it to continue.'

function mergeFiles(before: SavedFile[], after: SavedFile[]) {
  return [...new Map([...before, ...after].map((file) => [file.id, file])).values()]
    .sort((left, right) => right.messageId - left.messageId)
}

export default function SavedMessages({ folders, onBack }: { folders: Folder[]; onBack: () => void }) {
  const session = useRef<SavedSession | null>(null)
  const pending = useRef(false)
  const sendAbort = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [connected, setConnected] = useState(false)
  const [challenge, setChallenge] = useState<Challenge>()
  const [files, setFiles] = useState<SavedFile[]>([])
  const [metadata, setMetadata] = useState<TelegramMetadata[]>([])
  const [groups, setGroups] = useState<TelegramSubgroup[]>([])
  const [sourceId, setSourceId] = useState('')
  const [offset, setOffset] = useState<HistoryOffset>()
  const [job, setJob] = useState<Job>()
  const [selection, setSelection] = useState<string>()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const source = groups.find((group) => group.id === sourceId && group.state === 'archived')
  const sourceName = source?.name ?? 'Saved Messages'
  const sourcePeer = source?.state === 'archived' ? source.peer : null
  const sourceDescription = source?.state === 'archived' ? source.title : 'your Telegram account'
  const defaultFolderId = source?.albumId ?? null

  async function run(label: string, fallback: string, work: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(label)
    setNotice('')
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(rpcFailure(reason, fallback))
    } finally {
      pending.current = false
      setBusy('')
    }
  }

  async function refresh(client: SavedSession, nextSource = sourcePeer) {
    const [page, local] = await Promise.all([client.page(undefined, nextSource), readTelegramMetadata(client.accountId)])
    setFiles(mergeFiles([], page.files))
    setOffset(page.next)
    setMetadata(local)
  }

  async function onAuthorized(client: SavedSession) {
    setChallenge(undefined)
    setConnected(true)
    await Promise.all([
      refresh(client),
      readTelegramSubgroups(client.accountId).then(setGroups),
    ])
    setNotice('Saved Messages refreshed.')
  }

  function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || session.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    form.reset()
    void run('Requesting a Telegram sign-in code…', 'Could not request the sign-in code.', async () => {
      const client = createSavedSession(Number(fields.get('apiId')), String(fields.get('apiHash') ?? '').trim())
      try {
        const result = await client.requestCode(String(fields.get('phone') ?? ''))
        session.current = client
        if (result.kind !== 'signed-in') {
          setChallenge(result)
          return
        }
      } catch (reason) {
        await client.close(false).catch(() => {})
        throw reason
      }
      await onAuthorized(client)
    })
  }

  function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = session.current
    if (!client || !challenge || pending.current) return
    const form = event.currentTarget
    const answer = String(new FormData(form).get('answer') ?? '')
    form.reset()
    void run('Signing in to Telegram…', 'Could not complete sign-in or load Saved Messages. Try refreshing if you are signed in.', async () => {
      if (challenge.kind === 'password') {
        await client.submitPassword(answer)
      } else if (await client.submitCode(answer.trim()) === 'password') {
        setChallenge({ kind: 'password' })
        return
      }
      await onAuthorized(client)
    })
  }

  function signOut() {
    const client = session.current
    if (!client || pending.current) return
    const wasConnected = connected
    session.current = null
    setConnected(false)
    setChallenge(undefined)
    setFiles([])
    setMetadata([])
    setGroups([])
    setSourceId('')
    setOffset(undefined)
    setSelection(undefined)
    setJob(undefined)
    setSearch('')
    setFilter('all')
    void run(wasConnected ? 'Signing out…' : 'Closing sign-in…', 'The local session was cleared. Telegram did not confirm sign-out.', async () => {
      await client.close(wasConnected)
      if (wasConnected) setNotice('Telegram confirmed sign-out. The local session was cleared.')
    })
  }

  function load(reconnect = false) {
    const client = session.current
    if (!client) return
    void run(reconnect ? 'Reconnecting…' : `Refreshing ${sourceName}…`, 'Could not refresh the current Telegram chat.', async () => {
      if (reconnect) await client.reconnect()
      await refresh(client)
      setNotice(`${reconnect ? 'Reconnected to the same Telegram account. ' : ''}${sourceName} refreshed.`)
    })
  }

  function changeSource(id: string) {
    const client = session.current
    if (!client || job || id === sourceId) return
    const next = groups.find((group) => group.id === id)
    if (id && next?.state !== 'archived') return
    void run('Opening Telegram chat…', 'Could not open this Telegram chat.', async () => {
      await refresh(client, next?.state === 'archived' ? next.peer : null)
      setSourceId(id)
      setSelection(undefined)
      setSearch('')
      setFilter('all')
    })
  }

  async function addSubgroup(albumId: string, name: string) {
    const client = session.current
    if (!client) return false
    let added = false
    await run('Adding subgroup and setting up its Telegram chat…', subgroupFailure, async () => {
      const folder = folders.find((folder) => folder.id === albumId)
      if (!folder || !name || name.length > 60) {
        throw new TelegramError('Choose an album and enter a subgroup name of up to 60 characters.')
      }
      const group = { id: crypto.randomUUID(), albumId, name, state: 'draft' } as const
      try {
        await addTelegramSubgroup(client.accountId, group)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'ConstraintError') {
          await readTelegramSubgroups(client.accountId).then(setGroups)
          throw new TelegramError('This album already has a subgroup with that name.')
        }
        throw error
      }
      added = true
      await finishSubgroupSetup(client, folder, group)
    })
    return added
  }

  async function finishSubgroupSetup(client: SavedSession, folder: Folder, group: TelegramSubgroup) {
    try {
      await setUpSubgroup(client, folder.name, group)
    } finally {
      await readTelegramSubgroups(client.accountId).then(setGroups)
    }
    setNotice(`${group.name} is ready in Telegram Archive.`)
  }

  function retrySubgroupSetup(folder: Folder, group: TelegramSubgroup) {
    const client = session.current
    if (!client) return
    void run('Setting up Telegram subgroup…', subgroupFailure, () => finishSubgroupSetup(client, folder, group))
  }

  function loadMore() {
    const client = session.current
    if (!client || !offset) return
    void run('Loading older messages…', 'Could not load older messages.', async () => {
      const page = await client.page(offset, sourcePeer)
      setFiles((current) => mergeFiles(current, page.files))
      setOffset(page.next?.id === offset.id && page.next?.date === offset.date ? undefined : page.next)
      if (!page.files.length) setNotice(page.next ? 'No files on this page. You can load the next page.' : 'No more files.')
    })
  }

  function organize(file: SavedFile, values: Partial<Pick<TelegramMetadata, 'folderId' | 'favorite'>>) {
    void run('Saving in Limitless…', 'Could not save this album or favorite change.', async () => {
      const record = await patchTelegramMetadata(file.id, values, defaultFolderId)
      setMetadata((previous) => [...previous.filter((item) => item.id !== record.id), record])
    })
  }

  function stageFile(file: File | undefined) {
    if (!file || pending.current || job) return
    setError('')
    setNotice('')
    if (file.size === 0) {
      setError('Choose a file that contains data.')
      return
    }
    setJob({ file, id: newUploadId(), state: 'ready', progress: 0 })
  }

  function sendFile() {
    const client = session.current
    if (!client || !job || !['ready', 'failed', 'cancelled'].includes(job.state) || pending.current) return
    const controller = new AbortController()
    sendAbort.current = controller
    setJob({ ...job, state: 'sending', progress: 0 })
    void run(`Sending to ${sourceName}…`, 'Could not send the file. Retry the same transfer after checking your connection.', async () => {
      try {
        const file = await client.upload(job.file, job.id, controller.signal, (sent, total) => {
          if (!controller.signal.aborted && total > 0) {
            setJob((current) => current && { ...current, progress: Math.min(100, Math.floor(sent * 100 / total)) })
          }
        }, sourcePeer)
        setFiles((current) => mergeFiles(current, [file]))
        setSearch('')
        setFilter('all')
        setJob({ ...job, state: 'confirmed', progress: 100 })
        setNotice(`Telegram confirmed ${file.name} in ${sourceName} (#${file.messageId}).`)
      } catch (reason) {
        if (isDuplicateUpload(reason)) {
          setJob({ ...job, state: 'uncertain' })
          setNotice('Telegram has already seen this upload ID. Refresh the current chat to check for the file.')
        } else if (controller.signal.aborted) {
          setJob({ ...job, state: 'cancelled' })
          setNotice('Transfer cancelled locally. Retry this transfer to reuse its upload ID.')
        } else {
          setJob({ ...job, state: 'failed' })
          throw reason
        }
      } finally {
        sendAbort.current = null
      }
    })
  }

  const client = session.current
  const byId = new Map(metadata.map((item) => [item.id, item]))
  const archivedByAlbum = new Map<string, TelegramSubgroup[]>()
  for (const group of groups) {
    if (group.state !== 'archived') continue
    const album = archivedByAlbum.get(group.albumId)
    if (album) album.push(group)
    else archivedByAlbum.set(group.albumId, [group])
  }
  const items = files.map((file) => ({ ...file, folderId: defaultFolderId, ...byId.get(file.id) }))
  const selected = items.find((file) => file.id === selection)
  const term = search.trim().toLocaleLowerCase()
  const visible = items.filter((file) => file.name.toLocaleLowerCase().includes(term) &&
    (filter === 'all' || (filter === 'favorites' ? file.favorite : file.folderId === filter)))
  const media = visible.filter(isMedia)
  const documents = visible.filter((file) => !isMedia(file))
  const openFile = (file: SavedFile) => { setError(''); setSelection(file.id) }
  const favorite = (file: SavedFile) => organize(file, { favorite: !file.favorite })

  return <main className="saved-workspace">
    <div className="saved-navigation">
      <button className="back-link" onClick={onBack}><ArrowLeft size={17} /> Local library</button>
      <span className="saved-origin"><Send size={15} aria-hidden="true" /> Telegram Production</span>
    </div>
    <div className="page-head saved-heading">
      <div><h1>{sourceName}</h1><p>{connected ? `${items.length} loaded from ${sourceDescription}` : 'Your Telegram photos, videos, and files in Limitless.'}</p></div>
      {connected && <div className="saved-actions">
        <button className="button" onClick={() => load()} disabled={Boolean(busy)}><RefreshCw size={17} /> Refresh</button>
        <button className="button" onClick={() => load(true)} disabled={Boolean(busy)}>Reconnect</button>
        <button className="button" onClick={signOut} disabled={Boolean(busy)}>Sign out</button>
      </div>}
    </div>

    {busy || notice ? <p className="feedback saved-feedback" role="status">{busy || notice}</p> : null}
    {error && !selected && <p className="error banner saved-feedback" role="alert">{error}</p>}
    {!connected ? challenge ? <form className="saved-card saved-auth" key={challenge.kind} method="post" onSubmit={submitChallenge}>
      <h2>{challenge.kind === 'code' ? 'Enter the Telegram code' : 'Two-step verification'}</h2>
      <p>{challenge.kind === 'code' ? `Telegram reported code delivery via ${deliveries[challenge.delivery]}.` : 'Enter your Telegram two-step verification password.'}</p>
      {challenge.kind === 'code'
        ? <label>Sign-in code<input name="answer" inputMode="numeric" pattern="[0-9]+" autoComplete="one-time-code" required /></label>
        : <label>Two-step verification password<input name="answer" type="password" autoComplete="off" required /></label>}
      <div className="saved-actions"><button className="button primary" disabled={Boolean(busy)}>Verify and sign in</button>
        <button className="button" type="button" onClick={signOut} disabled={Boolean(busy)}>Start over</button></div>
    </form> : <form className="saved-card saved-auth" method="post" onSubmit={requestCode}>
      <h2>Connect your Telegram account</h2>
      <p>Use your own account. Limitless keeps the Telegram session in memory until you sign out or close the tab.</p>
      <div className="saved-credentials">
        <label>API ID<input name="apiId" inputMode="numeric" pattern="[0-9]+" autoComplete="off" required /></label>
        <label>API hash<input name="apiHash" type="password" autoComplete="off" minLength={32} maxLength={32} required /></label>
      </div>
      <label>Telegram phone number<input name="phone" type="tel" placeholder="+ followed by country code" autoComplete="off" required /></label>
      <p>Use the app credentials from <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">Telegram API development tools</a>.</p>
      <div><button className="button primary" disabled={Boolean(busy)}>Request sign-in code</button></div>
    </form> : <>
      <SubgroupSettings folders={folders} groups={groups} disabled={Boolean(busy)} onAdd={addSubgroup} onRetry={retrySubgroupSetup} />
      {archivedByAlbum.size > 0 && <div className="saved-tools saved-source">
        <label htmlFor="telegram-chat">Telegram chat</label>
        <select id="telegram-chat" value={sourceId} disabled={Boolean(busy) || Boolean(job)} onChange={(event) => changeSource(event.currentTarget.value)}>
          <option value="">Saved Messages</option>
          {folders.map((folder) => {
            const archived = archivedByAlbum.get(folder.id)
            return archived && <optgroup key={folder.id} label={folder.name}>
              {archived.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </optgroup>
          })}
        </select>
      </div>}
      <section className="saved-card saved-transfer" aria-label={`Upload to ${sourceName}`}>
        <div>
          <h2>{job?.file.name ?? 'Send a file'}</h2>
          <p>{job ? formatSize(job.file.size) + (job.state === 'sending' && job.progress === 100 ? ' · Waiting for Telegram to confirm' : '')
            : `Choose a file to send to ${sourceName}.`}</p>
        </div>
        <input ref={picker} type="file" hidden onChange={(event) => {
          stageFile(event.currentTarget.files?.[0])
          event.currentTarget.value = ''
        }} />
        {!job ? <button className="button primary" onClick={() => picker.current?.click()} disabled={Boolean(busy)}><FileUp size={17} /> Choose file</button>
          : job.state === 'sending' ? <div className="saved-progress">
            <progress aria-label="Upload progress" max={100} value={job.progress} />
            <button className="button" onClick={() => sendAbort.current?.abort()}>Cancel upload</button>
          </div> : <div className="saved-actions">
            {job.state === 'ready' && <button className="button primary" disabled={Boolean(busy)} onClick={sendFile}>Send to {sourceName}</button>}
            {(job.state === 'failed' || job.state === 'cancelled') && <button className="button primary" disabled={Boolean(busy)} onClick={sendFile}>Retry same transfer</button>}
            <button className="button" disabled={Boolean(busy)} onClick={() => {
              setJob(undefined); setError(''); setNotice('')
            }}>{job.state === 'confirmed' ? 'Done' : 'Dismiss'}</button>
          </div>}
      </section>

      <div className="saved-tools">
        <input type="search" placeholder="Search loaded files" aria-label={`Search ${sourceName}`} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        <label>Show <select value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
          <option value="all">All files</option><option value="favorites">Favorites</option>
          {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
      </div>
      {media.length > 0 && client && <MediaGallery files={media} busy={Boolean(busy)} onOpen={openFile} onFavorite={favorite}
        renderThumbnail={(file) => <SavedThumbnail session={client} file={file} />} />}
      {documents.length > 0 && <section className="documents saved-documents">
        {media.length > 0 && <h2>Other files</h2>}
        <FileList files={documents} folders={folders} busy={Boolean(busy)} onOpen={openFile} onFavorite={favorite} />
      </section>}
      {visible.length === 0 && <div className="empty">
        <span className="empty-icon"><Images size={25} aria-hidden="true" /></span>
        <h2>{term || filter !== 'all' ? 'No matching files' : 'No files on this page'}</h2>
        {offset && <p>Older messages may contain more files.</p>}
      </div>}
      {offset && <button className="button saved-load" disabled={Boolean(busy)} onClick={loadMore}>Load older messages</button>}
    </>}

    {selected && client && <SavedDetails key={selected.id} file={selected} folders={folders} session={client} sourceName={sourceName}
      organizing={Boolean(busy)} organizeError={error} onClose={() => { setSelection(undefined); setError('') }}
      onMove={(folderId) => organize(selected, { folderId })} />}
  </main>
}
