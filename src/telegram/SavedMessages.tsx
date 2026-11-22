import { useEffect, useRef, useState, type FormEvent } from 'react'
import parsePhoneNumber, { getCountries, getCountryCallingCode, type CountryCode } from 'libphonenumber-js/min'
import { ArrowLeft, FileUp, Images, RefreshCw, Send } from 'lucide-react'
import { FileList, MediaGallery } from '../Gallery'
import { androidDevice, exportAndroidFile, importAndroidSetup, isAndroidApp, type AndroidStatus } from '../android-device'
import { folderPaths, formatSize, isMedia, type Folder } from '../library'
import { addTelegramSubgroup, readTelegramIndex, readTelegramMetadata, readTelegramSubgroups, restoreTelegramIndex, telegramMessageLocation,
  updateTelegramMetadata, type TelegramIndexData, type TelegramMetadata, type TelegramSubgroup } from '../storage'
import { describeFailure, isExpiredTelegramSession, TelegramError } from './connection'
import { createSavedSession, isDuplicateUpload, newUploadId, type HistoryOffset, type SavedFile, type SavedSession, type UploadId } from './saved-client'
import { SavedDetails, SavedThumbnail } from './SavedDetails'
import { BatchActions, IndexBackup } from './SavedOrganization'
import { SubgroupSettings } from './SubgroupSettings'
import { setUpSubgroup } from './subgroups'
import { createIndexBackup, openIndexBackup, parseTags } from './index-backup'
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
const regionNames = new Intl.DisplayNames('en', { type: 'region' })
const countries = getCountries().map((country) => ({
  country,
  name: regionNames.of(country) ?? country,
  code: getCountryCallingCode(country),
})).sort((left, right) => left.name.localeCompare(right.name, 'en'))

function mergeFiles(before: SavedFile[], after: SavedFile[]) {
  return [...new Map([...before, ...after].map((file) => [file.id, file])).values()]
    .sort((left, right) => right.messageId - left.messageId)
}

export default function SavedMessages({ folders, onBack, onFoldersRestored }: {
  folders: Folder[]
  onBack: () => void
  onFoldersRestored: (folders: Folder[]) => void
}) {
  const session = useRef<SavedSession | null>(null)
  const pending = useRef(false)
  const sendAbort = useRef<AbortController | null>(null)
  const picker = useRef<HTMLInputElement>(null)
  const [connected, setConnected] = useState(false)
  const [device, setDevice] = useState<AndroidStatus>()
  const [country, setCountry] = useState<CountryCode>('IN')
  const [challenge, setChallenge] = useState<Challenge>()
  const [files, setFiles] = useState<SavedFile[]>([])
  const [metadata, setMetadata] = useState<TelegramMetadata[]>([])
  const [groups, setGroups] = useState<TelegramSubgroup[]>([])
  const [sourceId, setSourceId] = useState('')
  const [offset, setOffset] = useState<HistoryOffset>()
  const [job, setJob] = useState<Job>()
  const [selection, setSelection] = useState<string>()
  const [batch, setBatch] = useState<Set<string>>()
  const [backup, setBackup] = useState<TelegramIndexData>()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [tagFilter, setTagFilter] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const source = groups.find((group) => group.id === sourceId && group.state === 'archived')
  const sourceName = source?.name ?? 'Saved Messages'
  const sourcePeer = source?.state === 'archived' ? source.peer : null
  const sourceDescription = source?.state === 'archived' ? source.title : 'your Telegram account'
  const defaultFolderId = source?.albumId ?? null

  useEffect(() => {
    if (!isAndroidApp) return
    let active = true
    void androidDevice.status().then((status) => {
      if (active) setDevice(status)
    }).catch(() => {
      if (!active) return
      setDevice({ configured: false, savedSession: false })
      setError('Android could not read the local setup.')
    })
    return () => { active = false }
  }, [])

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
    setBatch(undefined)
  }

  async function onAuthorized(client: SavedSession) {
    setChallenge(undefined)
    setConnected(true)
    if (isAndroidApp) {
      try {
        await androidDevice.saveSession({ session: await client.exportSession() })
        setDevice({ configured: true, savedSession: true })
      } catch {
        setError('Signed in. Android could not save this sign-in for the next launch.')
      }
    }
    await Promise.all([
      refresh(client),
      readTelegramSubgroups(client.accountId).then(setGroups),
    ])
    setNotice('Saved Messages refreshed.')
  }

  function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current || session.current || (isAndroidApp && (!device?.configured || device.savedSession))) return
    const number = String(new FormData(event.currentTarget).get('phone') ?? '')
    void run('Requesting a Telegram sign-in code…', 'Could not request the sign-in code.', async () => {
      const phone = parsePhoneNumber(number, { defaultCountry: country, extract: false })
      if (!phone?.isPossible() || phone.ext) throw new TelegramError('Enter a complete phone number.')
      if (phone.countryCallingCode !== getCountryCallingCode(country)) {
        throw new TelegramError('Choose the country code that matches your phone number.')
      }
      const client = await createSavedSession()
      try {
        const result = await client.requestCode(phone.number)
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

  function configureDevice(file: File) {
    void run('Reading Android setup…', 'Could not import the Android setup file.', async () => {
      try {
        await importAndroidSetup(file)
      } catch (error) {
        throw new TelegramError(error instanceof Error ? error.message : 'Could not import the Android setup file.')
      }
      setDevice({ configured: true, savedSession: false })
      setNotice('Android setup saved. Enter your phone number to sign in.')
    })
  }

  function forgetSavedSession() {
    void run('Removing the saved sign-in…', 'Android could not remove the saved sign-in.', async () => {
      await androidDevice.clearSession()
      setDevice({ configured: true, savedSession: false })
      setNotice('The saved sign-in was removed from this device.')
    })
  }

  function resumeSavedSession() {
    void run('Resuming Telegram sign-in…', 'Could not resume sign-in. Check your connection and try again.', async () => {
      const { session: savedSession } = await androidDevice.readSession()
      if (!savedSession) {
        setDevice({ configured: true, savedSession: false })
        throw new TelegramError('The saved sign-in is unavailable. Sign in with your phone number.')
      }
      const client = await createSavedSession()
      try {
        await client.resume(savedSession)
      } catch (error) {
        await client.close(false).catch(() => {})
        if (isExpiredTelegramSession(error)) {
          await androidDevice.clearSession()
          setDevice({ configured: true, savedSession: false })
          throw new TelegramError('The saved Telegram session expired. Sign in with your phone number.')
        }
        throw error
      }
      session.current = client
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
    setBatch(undefined)
    setBackup(undefined)
    setJob(undefined)
    setSearch('')
    setFilter('all')
    setTagFilter('')
    void run(wasConnected ? 'Signing out…' : 'Closing sign-in…', 'The local session was cleared. Telegram did not confirm sign-out.', async () => {
      if (isAndroidApp && wasConnected) {
        try {
          await androidDevice.clearSession()
        } catch {
          await client.close(true).catch(() => {})
          throw new TelegramError('Android could not clear its saved sign-in. Use Forget saved sign-in to retry.')
        }
        setDevice({ configured: true, savedSession: false })
      }
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
      setTagFilter('')
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
      await setUpSubgroup(client, paths.get(folder.id) ?? folder.name, group)
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

  function organize(ids: string[], change: (record: TelegramMetadata) => TelegramMetadata) {
    if (!ids.length) return
    void run('Saving in Limitless…', 'Could not save these organization changes.', async () => {
      const records = await updateTelegramMetadata(ids, defaultFolderId, change)
      const updated = new Set(records.map((record) => record.id))
      setMetadata((previous) => [...previous.filter((item) => !updated.has(item.id)), ...records])
      if (batch) setNotice(`Updated ${records.length} selected files.`)
    })
  }

  function exportBackup() {
    const client = session.current
    if (!client) return
    void run('Preparing backup…', 'Could not export this backup.', async () => {
      const data = await readTelegramIndex(client.accountId)
      const backup = createIndexBackup(client.accountId, data)
      const name = `limitless-index-${new Date().toISOString().slice(0, 10)}.json`
      if (isAndroidApp) {
        setNotice(await exportAndroidFile(backup, name, 'save'))
        return
      }
      const url = URL.createObjectURL(backup)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      document.body.append(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 3000)
      setNotice('Organization backup exported.')
    })
  }

  function chooseBackup(file: File) {
    const client = session.current
    if (!client) return
    void run('Checking backup…', 'Could not open this backup.', async () => {
      setBackup(undefined)
      setBackup(await openIndexBackup(file, client.accountId))
    })
  }

  function restoreBackup() {
    const client = session.current
    if (!client || !backup) return
    void run('Restoring backup…', 'Could not restore organization from the backup.', async () => {
      const result = await restoreTelegramIndex(client.accountId, backup)
      const restored = await readTelegramIndex(client.accountId)
      onFoldersRestored(restored.folders)
      setMetadata(restored.metadata)
      setGroups(restored.subgroups)
      setBackup(undefined)
      setNotice(`Restored ${result.addedFolders.length} albums and ${result.importedCount} records. ${result.skipped} records skipped.`)
    })
  }

  function checkIndexedFiles() {
    const client = session.current
    if (!client) return
    void run('Checking indexed Telegram files…', 'Could not verify the indexed files in this chat.', async () => {
      const local = await readTelegramMetadata(client.accountId)
      const ids = local.flatMap((record) => {
        const location = telegramMessageLocation(client.accountId, record.id)
        return location?.chatId === (sourcePeer?.chatId ?? null) ? [location.messageId] : []
      })
      const missing = await client.missingIndexedFiles(ids, sourcePeer)
      setNotice(ids.length === 0 ? 'No files from this chat are in the organization index.'
        : `${ids.length - missing} of ${ids.length} indexed files are available in Telegram.${missing ? ' Missing files may have been deleted or had their attachments removed. Their organization records were kept.' : ''}`)
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
        setTagFilter('')
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
  const paths = folderPaths(folders)
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
  const possibleDuplicate = job?.state === 'ready' && files.some((file) => file.name === job.file.name && file.bytes === job.file.size)
  const tags = [...new Set([...items.flatMap((file) => file.tags ?? []), ...(tagFilter ? [tagFilter] : [])])].sort()
  const term = search.trim().toLocaleLowerCase()
  const visible = items.filter((file) => file.name.toLocaleLowerCase().includes(term) &&
    (filter === 'all' || (filter === 'favorites' ? file.favorite : file.folderId === filter)) &&
    (!tagFilter || file.tags?.includes(tagFilter)))
  const media = visible.filter(isMedia)
  const documents = visible.filter((file) => !isMedia(file))
  const openFile = (file: SavedFile) => {
    if (batch) {
      const next = new Set(batch)
      if (next.has(file.id)) next.delete(file.id)
      else next.add(file.id)
      setBatch(next)
      return
    }
    setError('')
    setSelection(file.id)
  }
  const favorite = (file: SavedFile) => organize([file.id], (record) => ({ ...record, favorite: !record.favorite }))

  return <main className="saved-workspace">
    <div className="saved-navigation">
      <button className="back-link" onClick={onBack}><ArrowLeft size={17} /> Local library</button>
      <span className="saved-origin"><Send size={15} aria-hidden="true" /> Telegram Production</span>
    </div>
    <div className="page-head saved-heading">
      <div><h1>{connected ? sourceName : 'Sign in to Limitless'}</h1>{connected && <p>{items.length} loaded from {sourceDescription}</p>}</div>
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
    </form> : isAndroidApp && (!device?.configured || device.savedSession) ? <section className="saved-card saved-auth">
      {!device ? <p role="status">Checking Android setup…</p> : device.configured && device.savedSession ? <>
        <h2>Continue with your saved sign-in</h2>
        <div className="saved-actions">
          <button className="button primary" disabled={Boolean(busy)} onClick={resumeSavedSession}>Resume saved sign-in</button>
          <button className="button" disabled={Boolean(busy)} onClick={forgetSavedSession}>Forget saved sign-in</button>
        </div>
      </> : <>
        <h2>Set up Telegram on this phone</h2>
        <p>Choose your Limitless Android setup file once. Then sign in with your phone number and Telegram code.</p>
        <div className="saved-actions"><label className="button saved-file-input">Choose Android setup file
          <input className="sr-only" type="file" accept="application/json,.json" disabled={Boolean(busy)} onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (file) configureDevice(file)
          }} />
        </label></div>
      </>}
    </section> : <form className="saved-card saved-auth" method="post" onSubmit={requestCode}>
      <h2>Continue with Telegram</h2>
      <p>Sign in once to open your Saved Messages and subgroup chats in Limitless.</p>
      <div className="saved-phone-fields">
        <div>
          <label htmlFor="telegram-country">Country code</label>
          <select id="telegram-country" value={country} autoComplete="country" onChange={(event) => setCountry(event.currentTarget.value as CountryCode)}>
            {countries.map(({ country, name, code }) => <option key={country} value={country}>{name} (+{code})</option>)}
          </select>
        </div>
        <label>Phone number<input name="phone" type="tel" autoComplete="tel-national" required /></label>
      </div>
      <div><button className="button primary" disabled={Boolean(busy)}>Request sign-in code</button></div>
    </form> : <>
      <SubgroupSettings folders={folders} groups={groups} disabled={Boolean(busy)} onAdd={addSubgroup} onRetry={retrySubgroupSetup} />
      <IndexBackup draft={backup} busy={Boolean(busy)} onExport={exportBackup} onChoose={chooseBackup}
        onRestore={restoreBackup} onCancel={() => setBackup(undefined)} onCheck={checkIndexedFiles} />
      {archivedByAlbum.size > 0 && <div className="saved-tools saved-source">
        <label htmlFor="telegram-chat">Telegram chat</label>
        <select id="telegram-chat" value={sourceId} disabled={Boolean(busy) || Boolean(job)} onChange={(event) => changeSource(event.currentTarget.value)}>
          <option value="">Saved Messages</option>
          {folders.map((folder) => {
            const archived = archivedByAlbum.get(folder.id)
            return archived && <optgroup key={folder.id} label={paths.get(folder.id)}>
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
          {possibleDuplicate && <p role="status">Possible duplicate. A loaded file in this chat has the same name and size.</p>}
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
            {job.state === 'ready' && <button className="button primary" disabled={Boolean(busy)} onClick={sendFile}>
              {possibleDuplicate ? 'Send anyway to' : 'Send to'} {sourceName}
            </button>}
            {(job.state === 'failed' || job.state === 'cancelled') && <button className="button primary" disabled={Boolean(busy)} onClick={sendFile}>Retry same transfer</button>}
            <button className="button" disabled={Boolean(busy)} onClick={() => {
              setJob(undefined); setError(''); setNotice('')
            }}>{job.state === 'confirmed' ? 'Done' : 'Dismiss'}</button>
          </div>}
      </section>

      <div className="saved-tools">
        <input type="search" placeholder="Search loaded files" aria-label={`Search ${sourceName}`} value={search} onChange={(event) => setSearch(event.currentTarget.value)} />
        <label>Show <select aria-label="Filter by album or favorites" value={filter} onChange={(event) => setFilter(event.currentTarget.value)}>
          <option value="all">All files</option><option value="favorites">Favorites</option>
          {[...paths].map(([id, path]) => <option key={id} value={id}>{path}</option>)}
        </select></label>
        {tags.length > 0 && <label>Tag <select aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.currentTarget.value)}>
          <option value="">All tags</option>
          {tags.map((tag) => <option key={tag}>{tag}</option>)}
        </select></label>}
        {!batch && <button className="button" disabled={Boolean(busy) || !visible.length} onClick={() => setBatch(new Set())}>Select files</button>}
      </div>
      {batch && <BatchActions count={batch.size} hasVisibleFiles={visible.length > 0} paths={paths} busy={Boolean(busy)}
        onAll={() => setBatch(new Set([...batch, ...visible.map((file) => file.id)]))} onDone={() => setBatch(undefined)}
        onMove={(folderId) => organize([...batch], (record) => ({ ...record, folderId }))}
        onFavorite={() => organize([...batch], (record) => ({ ...record, favorite: true }))}
        onTag={(input) => organize([...batch], (record) => ({ ...record, tags: parseTags([...(record.tags ?? []), input].join(',')) }))} />}
      {media.length > 0 && client && <MediaGallery files={media} busy={Boolean(busy)} selection={batch} onOpen={openFile} onFavorite={favorite}
        renderThumbnail={(file) => <SavedThumbnail session={client} file={file} />} />}
      {documents.length > 0 && <section className="documents saved-documents">
        {media.length > 0 && <h2>Other files</h2>}
        <FileList files={documents} folders={folders} busy={Boolean(busy)} selection={batch} onOpen={openFile} onFavorite={favorite} />
      </section>}
      {visible.length === 0 && <div className="empty">
        <span className="empty-icon"><Images size={25} aria-hidden="true" /></span>
        <h2>{term || tagFilter || filter !== 'all' ? 'No matching files' : 'No files on this page'}</h2>
        {offset && <p>Older messages may contain more files.</p>}
      </div>}
      {offset && <button className="button saved-load" disabled={Boolean(busy)} onClick={loadMore}>Load older messages</button>}
    </>}

    {selected && client && <SavedDetails key={selected.id} file={selected} folders={folders} session={client} sourceName={sourceName}
      organizing={Boolean(busy)} organizeError={error} onClose={() => { setSelection(undefined); setError('') }}
      onMove={(folderId) => organize([selected.id], (record) => ({ ...record, folderId }))}
      onTags={(input) => organize([selected.id], (record) => ({ ...record, tags: parseTags(input) }))} />}
  </main>
}
