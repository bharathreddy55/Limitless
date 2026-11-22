import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { FlaskConical, Infinity, ShieldAlert } from 'lucide-react'
import { createSession, describeFailure, sampleSizes, type HistoryOffset, type SampleSize, type Session, type TelegramEnvironment, type TestFile, type Upload } from './client'
import { readPilotRecord, type PilotRecord } from './pilot-record'
import '../styles.css'
import './styles.css'

const sizeLabels = { 1024: '1 KiB', 65536: '64 KiB', 262144: '256 KiB' }
type Challenge = { phone: string; kind: 'code'; delivery: 'app' | 'sms' | 'call' | 'email' }
  | { phone: string; kind: 'password' }
const codeDelivery = { app: 'your signed-in Telegram app', sms: 'SMS', call: 'a phone call', email: 'email' }
const maskedPhone = (phone: string) => `•••• ${phone.replace(/\D/g, '').slice(-4)}`

function Lab({ environment }: { environment: TelegramEnvironment }) {
  const production = environment === 'production'
  const session = useRef<Session | null>(null)
  const running = useRef(false)
  const [phone, setPhone] = useState('')
  const [challenge, setChallenge] = useState<Challenge>()
  const [size, setSize] = useState<SampleSize>(65536)
  const [files, setFiles] = useState<TestFile[]>([])
  const [next, setNext] = useState<HistoryOffset>()
  const [upload, setUpload] = useState<Upload>()
  const [verified, setVerified] = useState(false)
  const [pilotRecord, setPilotRecord] = useState<PilotRecord | null>()
  const [pilotStorageError, setPilotStorageError] = useState(false)
  const [downloadHash, setDownloadHash] = useState('')
  const [pilotReconnected, setPilotReconnected] = useState(false)
  const [busy, setBusy] = useState('')
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  async function refreshPilotRecord() {
    try {
      setPilotRecord((await readPilotRecord()) ?? null)
      setPilotStorageError(false)
    } catch {
      setPilotStorageError(true)
    }
  }

  useEffect(() => {
    if (production) void refreshPilotRecord()
  }, [production])

  async function run(label: string, fallback: string, work: () => Promise<void>) {
    if (running.current) return
    running.current = true
    setBusy(label)
    setStatus('')
    setError('')
    try {
      await work()
    } catch (reason) {
      setError(describeFailure(reason, fallback, environment))
    } finally {
      running.current = false
      setBusy('')
    }
  }

  function finishSignIn(number: string) {
    setChallenge(undefined)
    setPhone(number)
    setStatus(production ? 'Signed in to Telegram Production.' : 'Signed in to Telegram’s test environment. Load Saved Messages or upload a generated file.')
  }

  function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (running.current || session.current) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const apiId = Number(fields.get('apiId'))
    const apiHash = String(fields.get('apiHash') ?? '').trim()
    const number = String(fields.get('phone') ?? '').trim()
    form.reset()
    void run(production ? 'Connecting to Telegram Production…' : 'Connecting to Telegram test servers…',
      'Could not request a sign-in code from Telegram.', async () => {
      const client = createSession(environment, apiId, apiHash)
      try {
        const result = await client.requestCode(number)
        session.current = client
        if (result.kind === 'signed-in') finishSignIn(number)
        else setChallenge({ ...result, phone: number })
      } catch (reason) {
        await client.close(false).catch(() => {})
        throw reason
      }
    })
  }

  function submitChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const client = session.current
    if (running.current || !client || !challenge) return
    const form = event.currentTarget
    const input = String(new FormData(form).get('answer') ?? '')
    form.reset()
    void run('Verifying with Telegram…', 'Telegram could not complete sign-in for this account.', async () => {
      if (challenge.kind === 'password') {
        await client.submitPassword(input)
      } else if (await client.submitCode(input.trim()) === 'password') {
        setChallenge({ kind: 'password', phone: challenge.phone })
        return
      }
      finishSignIn(challenge.phone)
    })
  }

  function startOver() {
    const client = session.current
    if (!client || !challenge) return
    void run('Closing the pending sign-in…', 'The local connection was cleared.', async () => {
      try {
        await client.close(false)
      } finally {
        session.current = null
        setChallenge(undefined)
      }
    })
  }

  function loadHistory(older = false) {
    const client = session.current
    if (!client || (older && !next)) return
    void run('Reading Saved Messages…', 'Could not read Saved Messages.', async () => {
      const page = await client.history(older ? next : undefined)
      setFiles((current) => [...new Map([...(older ? current : []), ...page.files].map((file) => [file.id, file])).values()])
      setNext(page.next)
      setStatus(page.files.length ? `Found ${page.files.length} test files on this page.` : 'No generated test files on this page.')
    })
  }

  function uploadFile() {
    const client = session.current
    if (!client) return
    void run('Uploading generated bytes…', 'Telegram did not confirm the upload. Check Saved Messages before trying again.', async () => {
      const result = await client.upload(size)
      setUpload(result)
      setVerified(false)
      setStatus(`Saved Messages confirmed upload #${result.id}. Verify it to check that the bytes round-trip.`)
    })
  }

  function verifyFile() {
    const client = session.current
    if (!client || !upload) return
    void run('Downloading and comparing SHA-256…', 'Could not retrieve or verify this file. The upload may still be in Saved Messages.', async () => {
      setVerified(false)
      await client.verify(upload)
      setVerified(true)
      setStatus(`SHA-256 matched for ${upload.bytes.toLocaleString()} bytes downloaded from Saved Messages.`)
    })
  }

  function uploadPilotFile() {
    const client = session.current
    if (!client || pilotRecord !== null || pilotStorageError) return
    void run('Uploading one generated 64 KiB file…', 'The pilot could not confirm the upload. Check Saved Messages for the filename below.', async () => {
      try {
        const id = await client.uploadPilot()
        setStatus(`Saved Messages confirmed the 64 KiB upload (#${id}). You can now verify the download.`)
      } finally {
        await refreshPilotRecord()
      }
    })
  }

  function verifyPilotFile() {
    const client = session.current
    if (!client) return
    void run('Downloading the pilot file and checking SHA-256…', 'Could not verify the pilot file.', async () => {
      setDownloadHash('')
      setDownloadHash(await client.verifyPilot())
      setStatus('SHA-256 matched for all 65,536 bytes downloaded from Saved Messages.')
    })
  }

  function reconnect() {
    const client = session.current
    if (!client) return
    if (production) {
      void run('Reconnecting to Telegram Production…', 'Could not reconnect and find the pilot file.', async () => {
        setPilotReconnected(false)
        await client.reconnect()
        setPilotReconnected(true)
        setStatus('Reconnected to the same account and found the same pilot message.')
      })
      return
    }
    void run('Checking history across a reconnect…', 'Could not restore the test connection.', async () => {
      const before = await client.history()
      await client.reconnect()
      const after = await client.history()
      setFiles(after.files)
      setNext(after.next)
      const sameIds = before.files.map((file) => file.id).join(',') === after.files.map((file) => file.id).join(',')
      const hasDuplicates = new Set(after.files.map((file) => file.id)).size !== after.files.length
      setStatus(sameIds && !hasDuplicates
        ? after.files.length ? 'Reconnected. The latest page returned the same test files without duplicates.' : 'Reconnected. Upload a test file to check duplicate handling.'
        : 'Reconnected, but the latest page changed or contained duplicates. Review the list.')
    })
  }

  function signOut() {
    const client = session.current
    if (!client) return
    void run('Signing out…', 'The local session was cleared. Telegram did not confirm sign-out.', async () => {
      try {
        await client.close(true)
        setStatus('Telegram confirmed sign-out. The local session was cleared.')
      } finally {
        session.current = null
        setPhone('')
        setFiles([])
        setNext(undefined)
        setUpload(undefined)
        setVerified(false)
        setDownloadHash('')
        setPilotReconnected(false)
      }
    })
  }

  const working = Boolean(busy)
  return <main className="lab">
    {Capacitor.isNativePlatform()
      ? <div className="brand lab-brand"><span className="brand-icon"><Infinity size={22} aria-hidden="true" /></span>Limitless</div>
      : <a className="brand lab-brand" href="/"><span className="brand-icon"><Infinity size={22} aria-hidden="true" /></span>Limitless</a>}
    <header className="lab-header">
      {production
        ? <span className="lab-badge production"><ShieldAlert size={16} aria-hidden="true" /> Production</span>
        : <span className="lab-badge"><FlaskConical size={16} aria-hidden="true" /> Telegram test servers</span>}
      <h1>{production ? 'Telegram Production Pilot' : 'Telegram test lab'}</h1>
      <p>{production
        ? 'Sign in with your own Telegram account. The upload button sends one generated 64 KiB file to your real Saved Messages. Your sign-in session stays in this tab’s memory.'
        : 'Check sign-in and file transfers with an account registered on Telegram’s Test Server. The lab uploads generated bytes and keeps the session in this tab’s memory.'}</p>
    </header>
    {!phone ? challenge ? <form className="lab-panel" key={challenge.kind} method="post" onSubmit={submitChallenge}>
      <h2>{challenge.kind === 'code' ? production ? 'Enter the Telegram code' : 'Enter the test code' : 'Enter the two-step verification password'}</h2>
      <p className="lab-muted">{challenge.kind === 'code'
        ? `Telegram reported code delivery via ${codeDelivery[challenge.delivery]}. Enter the code for ${maskedPhone(challenge.phone)}.`
        : 'Use the two-step verification password for the account you’re signing in to.'}</p>
      <div className="lab-fields">
        {challenge.kind === 'code'
          ? <label>{production ? 'Telegram sign-in code' : 'Test sign-in code'}<input name="answer" inputMode="numeric" pattern="[0-9]+" autoComplete="one-time-code" required /></label>
          : <label>Two-step verification password<input name="answer" type="password" autoComplete="off" required /></label>}
      </div>
      <div className="lab-row lab-controls">
        <button className="button primary" disabled={working}>Verify and sign in</button>
        <button className="button" type="button" disabled={working} onClick={startOver}>Start over</button>
      </div>
    </form> : <form className="lab-panel" method="post" onSubmit={requestCode}>
      <h2>{production ? 'Sign in to your Telegram account' : 'Open a test session'}</h2>
      <div className="lab-fields">
        <label>API ID<input name="apiId" inputMode="numeric" required pattern="[0-9]+" autoComplete="off" /></label>
        <label>API hash<input name="apiHash" type="password" required minLength={32} maxLength={32} autoComplete="off" /></label>
      </div>
      <p className="lab-muted">Use the API ID and hash from <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer">Telegram API development tools</a>.</p>
      <div className="lab-fields">
        <label>{production ? 'Telegram phone number' : 'Test Server phone number'}<input name="phone" type="tel" required autoComplete="off" /></label>
      </div>
      <p className="lab-muted">Start with + and the country code. {production
        ? 'Use the number on your own Telegram account.'
        : <>Use the number you registered on <a href="https://core.telegram.org/bots/webapps#testing-mini-apps" target="_blank" rel="noreferrer">Telegram’s Test Server</a>.</>}</p>
      <button className="button primary" disabled={working}>{production ? 'Request Telegram sign-in code' : 'Request test sign-in code'}</button>
    </form> : production ? <section className="lab-panel" aria-label="Production transfer">
      <div className="lab-row"><h2>Production account {maskedPhone(phone)}</h2><button className="button" disabled={working} onClick={signOut}>Sign out</button></div>
      {pilotStorageError ? <p className="lab-error" role="alert">Browser storage is unavailable. The pilot cannot safely send a file.</p>
        : pilotRecord === undefined ? <p className="lab-muted">Checking the one-file upload slot…</p>
        : pilotRecord === null ? <>
          <p className="lab-muted">This uploads one generated 64 KiB file to your Saved Messages. The pilot reserves the slot before sending to prevent a second upload after a reload or interrupted connection.</p>
          <button className="button primary" disabled={working} onClick={uploadPilotFile}>Upload one 64 KiB file</button>
        </> : <div className="lab-proof">
          <strong>{pilotRecord.id === undefined ? 'Upload not confirmed' : `Saved Messages #${pilotRecord.id} · 64 KiB`}</strong>
          <span>{pilotRecord.name}</span>
          <span>Original SHA-256 <code>{pilotRecord.sha256}</code></span>
          {pilotRecord.id === undefined ? <p>Check your Saved Messages in Telegram for this filename. The single upload slot remains reserved.</p>
            : <div className="lab-row lab-controls">
              <button className="button primary" disabled={working} onClick={verifyPilotFile}>Verify download</button>
              <button className="button" disabled={working} onClick={reconnect}>Reconnect</button>
            </div>}
          {downloadHash && <><span>Downloaded SHA-256 <code>{downloadHash}</code></span><strong className="lab-match">Downloaded checksum matches</strong></>}
          {pilotReconnected && <strong className="lab-match">Same message found after reconnect</strong>}
        </div>}
    </section> : <>
      <section className="lab-panel" aria-label="Test transfer">
        <div className="lab-row"><h2>Test account {maskedPhone(phone)}</h2><button className="button" disabled={working} onClick={signOut}>Sign out</button></div>
        <div className="lab-row">
          <label className="lab-size">Test file size
            <select value={size} disabled={working} onChange={(event) => setSize(Number(event.target.value) as SampleSize)}>
              {sampleSizes.map((bytes) => <option key={bytes} value={bytes}>{sizeLabels[bytes]}</option>)}
            </select>
          </label>
          <button className="button primary" disabled={working} onClick={uploadFile}>Upload generated file</button>
        </div>
        {upload && <div className="lab-proof">
          <strong>Test upload #{upload.id}</strong>
          <span>{upload.name}</span>
          <span>Original SHA-256 <code>{upload.sha256}</code></span>
          <button className="button" disabled={working} onClick={verifyFile}>Verify download</button>
          {verified && <strong className="lab-match">Downloaded checksum matches</strong>}
        </div>}
      </section>
      <section className="lab-panel" aria-label="Saved Messages">
        <h2>Saved Messages</h2>
        <div className="lab-row lab-controls">
          <button className="button" disabled={working} onClick={() => loadHistory()}>Refresh</button>
          {next && <button className="button" disabled={working} onClick={() => loadHistory(true)}>Load older</button>}
          <button className="button" disabled={working} onClick={reconnect}>Reconnect and compare</button>
        </div>
        {files.length ? <ul className="lab-list">{files.map((file) => <li key={file.id}>{file.name} <span>#{file.id}</span></li>)}</ul>
          : <p className="lab-muted">Generated test files appear here after you refresh.</p>}
      </section>
    </>}
    {busy || status ? <p className="lab-status" role="status">{busy || status}</p> : null}
    {error && <p className="lab-error" role="alert">{error}</p>}
  </main>
}

const localHost = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)
const nativeLab = import.meta.env.MODE === 'telegram-mobile-lab' && Capacitor.isNativePlatform()
const production = location.pathname === '/telegram-pilot.html'
const allowed = localHost && (production ? import.meta.env.DEV && !Capacitor.isNativePlatform() : import.meta.env.DEV || nativeLab)
const cryptoAvailable = window.isSecureContext && typeof window.crypto?.subtle?.digest === 'function'
const root = createRoot(document.getElementById('root')!)
root.render(allowed && cryptoAvailable
  ? <Lab environment={production ? 'production' : 'test'} />
  : <main className="lab"><h1>Telegram test lab</h1>
    <p>{allowed
      ? 'This browser or WebView does not provide the secure cryptography needed for Telegram testing.'
      : 'Open the local development server or the Limitless mobile test app to use the lab.'}</p>
  </main>)
