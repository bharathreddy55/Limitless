import type { FormEvent } from 'react'
import { folderPaths, type Folder } from '../library'
import type { TelegramSubgroup } from '../storage'

const stateText = {
  draft: 'Chat setup needed',
  pending: 'Creation needs confirmation',
  created: 'Ready to archive',
  archived: 'Added to Telegram Archive',
}
const actions = { draft: 'Set up chat', pending: 'Find created chat', created: 'Archive chat' }

export function SubgroupSettings({ folders, groups, disabled, onAdd, onRetry }: {
  folders: Folder[]
  groups: TelegramSubgroup[]
  disabled: boolean
  onAdd: (albumId: string, name: string) => Promise<boolean>
  onRetry: (folder: Folder, group: TelegramSubgroup) => void
}) {
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const paths = folderPaths(folders)

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const fields = new FormData(form)
    void onAdd(String(fields.get('album')), String(fields.get('name')).trim().normalize('NFC')).then((added) => {
      if (added) form.reset()
    })
  }

  return <details className="saved-card saved-subgroups">
    <summary>Telegram subgroups</summary>
    <p>Adding a subgroup creates a private chat in your Telegram account and archives it automatically.</p>
    {folders.length ? <form className="saved-subgroup-form" onSubmit={add}>
      <label>Parent album<select name="album" required disabled={disabled}>
        {[...paths].map(([id, path]) => <option key={id} value={id}>{path}</option>)}
      </select></label>
      <label>Subgroup name<input name="name" maxLength={60} required disabled={disabled} /></label>
      <button className="button" disabled={disabled}>Add subgroup</button>
    </form> : <p>Create an album in the local library to get started.</p>}
    {groups.length > 0 && <ul className="saved-subgroup-list">
      {groups.map((group) => {
        const folder = byId.get(group.albumId)
        if (!folder) return null
        return <li key={group.id}>
          <div>
            <strong>{paths.get(folder.id)} / {group.name}</strong>
            <p>{stateText[group.state]}{group.state !== 'draft' && ` · ${group.title}`}</p>
          </div>
          {group.state !== 'archived' && <button className="button" disabled={disabled}
            onClick={() => onRetry(folder, group)}>{actions[group.state]}</button>}
        </li>
      })}
    </ul>}
  </details>
}
