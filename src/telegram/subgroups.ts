import { replaceTelegramSubgroup, type TelegramChatAddress, type TelegramSubgroup } from '../storage'
import { TelegramError } from './connection'
import { groupCreationRejected, type SavedSession } from './saved-client'

async function update(client: SavedSession, before: TelegramSubgroup, next: TelegramSubgroup) {
  if (!await replaceTelegramSubgroup(client.accountId, before, next)) {
    throw new TelegramError('This subgroup changed in another tab. Its status has been refreshed.')
  }
}

export async function setUpSubgroup(client: SavedSession, albumName: string, group: TelegramSubgroup) {
  if (group.state === 'archived') return
  let title: string
  let peer: TelegramChatAddress | undefined
  if (group.state === 'draft') {
    title = `${Array.from(albumName).slice(-60).join('')} · ${group.name}`
    const pending = { ...group, title, state: 'pending' } as const
    await update(client, group, pending)
    try {
      peer = await client.createSubgroup(title, group.id)
    } catch (error) {
      if (groupCreationRejected(error)) await update(client, pending, group)
      throw error
    }
    group = pending
  } else {
    title = group.title
  }
  if (group.state === 'pending') {
    peer ??= await client.findSubgroup(title, group.id)
    if (!peer) throw new TelegramError('No matching chat was found. If Telegram is still processing the request, try Find created chat again later.')
    const created = { ...group, peer, state: 'created' } as const
    await update(client, group, created)
    group = created
  }
  // Keep the confirmed chat address even when archiving fails.
  await client.archiveSubgroup(group.peer)
  await update(client, group, { ...group, state: 'archived' })
}
