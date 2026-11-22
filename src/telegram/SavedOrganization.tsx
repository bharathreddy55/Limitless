import type { TelegramIndexData } from '../storage'

export function IndexBackup({ draft, busy, onExport, onChoose, onRestore, onCancel, onCheck }: {
  draft: TelegramIndexData | undefined
  busy: boolean
  onExport: () => void
  onChoose: (file: File) => void
  onRestore: () => void
  onCancel: () => void
  onCheck: () => void
}) {
  return <details className="saved-card saved-subgroups">
    <summary>Organization backup</summary>
    <p>Back up this account’s album assignments, tags, favorites, and Telegram subgroup links.</p>
    <div className="saved-backup-actions">
      <button className="button" disabled={busy} onClick={onExport}>Export backup</button>
      <label className="button saved-file-input">Choose backup
        <input className="sr-only" type="file" accept="application/json,.json" disabled={busy} onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) onChoose(file)
        }} />
      </label>
      <button className="button" disabled={busy} onClick={onCheck}>Check indexed files in this chat</button>
    </div>
    {draft && <div className="saved-backup-preview">
      <p>{draft.folders.length} albums · {draft.subgroups.length} subgroup links · {draft.metadata.length} file records</p>
      <p>Restoring merges the backup with your current organization and keeps existing records.</p>
      <div className="saved-actions">
        <button className="button primary" disabled={busy} onClick={onRestore}>Restore backup</button>
        <button className="button" disabled={busy} onClick={onCancel}>Cancel restore</button>
      </div>
    </div>}
  </details>
}

export function BatchActions({ count, hasVisibleFiles, paths, busy, onAll, onDone, onMove, onFavorite, onTag }: {
  count: number
  hasVisibleFiles: boolean
  paths: ReadonlyMap<string, string>
  busy: boolean
  onAll: () => void
  onDone: () => void
  onMove: (folderId: string | null) => void
  onFavorite: () => void
  onTag: (tag: string) => void
}) {
  return <section className="saved-card saved-batch" aria-label="File selection">
    <div className="saved-actions">
      <strong>{count} selected</strong>
      <button className="button" disabled={!hasVisibleFiles || busy} onClick={onAll}>Select all shown</button>
      <button className="button" disabled={count === 0 || busy} onClick={onFavorite}>Favorite selected</button>
      <button className="button" disabled={busy} onClick={onDone}>Exit selection</button>
    </div>
    <form className="saved-inline-form" onSubmit={(event) => {
      event.preventDefault()
      onMove(String(new FormData(event.currentTarget).get('folder') ?? '') || null)
    }}>
      <label>Assign album<select name="folder" disabled={!count || busy}>
        <option value="">No album</option>
        {[...paths].map(([id, path]) => <option key={id} value={id}>{path}</option>)}
      </select></label>
      <button className="button" disabled={!count || busy}>Apply album</button>
    </form>
    <form className="saved-inline-form" onSubmit={(event) => {
      event.preventDefault()
      onTag(String(new FormData(event.currentTarget).get('tags') ?? ''))
    }}>
      <label>Add tags<input name="tags" placeholder="Separate tags with commas" required disabled={!count || busy} /></label>
      <button className="button" disabled={!count || busy}>Apply tags</button>
    </form>
  </section>
}
