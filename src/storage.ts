import { sampleLibrary, type Folder, type Library, type LibraryFile, type Theme } from './library'

const stores = ['files', 'folders', 'preferences'] as const
type Store = typeof stores[number]

let database: Promise<IDBDatabase> | undefined

function openDatabase() {
  if (!database) {
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('limitless-library', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('files', { keyPath: 'id' })
        request.result.createObjectStore('folders', { keyPath: 'id' })
        request.result.createObjectStore('preferences')
      }
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close()
        resolve(request.result)
      }
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(new Error('Close other Limitless tabs and reload.'))
    })
  }
  return database
}

function committed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error ?? new Error('The storage transaction was interrupted.'))
  })
}

async function readLibrary(db: IDBDatabase): Promise<Library | null> {
  const transaction = db.transaction([...stores], 'readonly')
  const done = committed(transaction)
  const preferences = transaction.objectStore('preferences')
  const initialization = preferences.get('initialized')
  const files = transaction.objectStore('files').getAll()
  const folders = transaction.objectStore('folders').getAll()
  const theme = preferences.get('theme')
  await done
  return initialization.result ? { files: files.result, folders: folders.result, theme: theme.result ?? 'system' } : null
}

let initialization: Promise<void> | undefined

function seedLibrary(db: IDBDatabase) {
  initialization ??= (async () => {
    const library = await sampleLibrary()
    const transaction = db.transaction([...stores], 'readwrite')
    const done = committed(transaction)
    const preferences = transaction.objectStore('preferences')
    const initialized = preferences.get('initialized')
    initialized.onsuccess = () => {
      if (initialized.result) return
      const files = transaction.objectStore('files')
      const folders = transaction.objectStore('folders')
      library.files.forEach((file) => files.add(file))
      library.folders.forEach((folder) => folders.add(folder))
      preferences.put(true, 'initialized')
    }
    await done
  })().finally(() => { initialization = undefined })
  return initialization
}

export async function loadLibrary(): Promise<Library> {
  const db = await openDatabase()
  const existing = await readLibrary(db)
  if (existing) return existing
  await seedLibrary(db)
  const library = await readLibrary(db)
  if (!library) throw new Error('The library did not load.')
  return library
}

async function write(store: Store, operation: (store: IDBObjectStore) => void) {
  const db = await openDatabase()
  const transaction = db.transaction(store, 'readwrite')
  operation(transaction.objectStore(store))
  await committed(transaction)
}

export const addFiles = (files: LibraryFile[]) => write('files', (store) => files.forEach((file) => store.add(file)))
export const putFile = (file: LibraryFile) => write('files', (store) => store.put(file))
export const removeFile = (id: string) => write('files', (store) => store.delete(id))
export const addFolder = (folder: Folder) => write('folders', (store) => store.add(folder))
export const putTheme = (theme: Theme) => write('preferences', (store) => store.put(theme, 'theme'))

export type TelegramMetadata = { id: string; folderId: string | null; favorite: boolean; tags?: string[] }
export type TelegramChatAddress = { chatId: number; channelId: number }
export type TelegramSubgroup = { id: string; albumId: string; name: string } & (
  | { state: 'draft' }
  | { state: 'pending'; title: string }
  | { state: 'created' | 'archived'; title: string; peer: TelegramChatAddress }
)

export type TelegramIndexData = { folders: Folder[]; metadata: TelegramMetadata[]; subgroups: TelegramSubgroup[] }

const metadataPrefix = (account: number) => `telegram:${account}:`
const subgroupPrefix = (account: number) => `telegram-subgroup:${account}:`
const range = (prefix: string) => IDBKeyRange.bound(prefix, prefix + '\uffff')

export function telegramMessageLocation(account: number, id: string) {
  const prefix = metadataPrefix(account)
  if (!id.startsWith(prefix)) return
  const match = /^(?:self|group:(-[1-9]\d*)):([1-9]\d*)$/.exec(id.slice(prefix.length))
  if (!match) return
  const chatId = match[1] ? Number(match[1]) : null
  const messageId = Number(match[2])
  if ((chatId !== null && !Number.isSafeInteger(chatId)) || messageId > 2_147_483_647) return
  return { chatId, messageId }
}

async function readPreferences<T>(prefix: string): Promise<T[]> {
  const db = await openDatabase()
  const tx = db.transaction('preferences')
  const done = committed(tx)
  const records = tx.objectStore('preferences').getAll(range(prefix))
  await done
  return records.result
}

export const readTelegramMetadata = (account: number) => readPreferences<TelegramMetadata>(metadataPrefix(account))
const subgroupKey = (account: number, group: Pick<TelegramSubgroup, 'albumId' | 'name'>) =>
  subgroupPrefix(account) + JSON.stringify([group.albumId, group.name.toLowerCase()])

export const readTelegramSubgroups = (account: number) => readPreferences<TelegramSubgroup>(subgroupPrefix(account))

export const addTelegramSubgroup = (account: number, group: TelegramSubgroup) =>
  write('preferences', (store) => store.add(group, subgroupKey(account, group)))

export async function replaceTelegramSubgroup(account: number, before: TelegramSubgroup, next: TelegramSubgroup) {
  const db = await openDatabase()
  const tx = db.transaction('preferences', 'readwrite')
  const done = committed(tx)
  const store = tx.objectStore('preferences')
  const key = subgroupKey(account, before)
  const lookup = store.get(key)
  let replaced = false
  lookup.onsuccess = () => {
    const current: TelegramSubgroup | undefined = lookup.result
    if (current?.id !== before.id || current.state !== before.state) return
    store.put(next, key)
    replaced = true
  }
  await done
  return replaced
}

export async function updateTelegramMetadata(ids: string[], defaultFolderId: string | null,
  change: (previous: TelegramMetadata) => TelegramMetadata) {
  const db = await openDatabase()
  const tx = db.transaction('preferences', 'readwrite')
  const done = committed(tx)
  const store = tx.objectStore('preferences')
  const updated: TelegramMetadata[] = []
  let failure: unknown
  for (const id of new Set(ids)) {
    const lookup = store.get(id)
    lookup.onsuccess = () => {
      try {
        const record = change({ id, folderId: defaultFolderId, favorite: false, ...lookup.result })
        store.put(record, id)
        updated.push(record)
      } catch (error) {
        failure = error
        tx.abort()
      }
    }
  }
  await done.catch((error) => { throw failure ?? error })
  return updated
}

function readIndexStores(tx: IDBTransaction, account: number) {
  const prefs = tx.objectStore('preferences')
  return {
    folders: tx.objectStore('folders').getAll(),
    metadata: prefs.getAll(range(metadataPrefix(account))),
    subgroups: prefs.getAll(range(subgroupPrefix(account))),
  }
}

export async function readTelegramIndex(account: number): Promise<TelegramIndexData> {
  const db = await openDatabase()
  const tx = db.transaction(['folders', 'preferences'])
  const done = committed(tx)
  const rows = readIndexStores(tx, account)
  await done
  return { folders: rows.folders.result, metadata: rows.metadata.result, subgroups: rows.subgroups.result }
}

export async function restoreTelegramIndex(account: number, backup: TelegramIndexData) {
  const db = await openDatabase()
  const tx = db.transaction(['folders', 'preferences'], 'readwrite')
  const done = committed(tx)
  const rows = readIndexStores(tx, account)
  const prefs = tx.objectStore('preferences')
  const folderStore = tx.objectStore('folders')
  const addedFolders: Folder[] = []
  let importedCount = 0

  rows.subgroups.onsuccess = () => {
    const folderIds = new Set<string>(rows.folders.result.map((folder: Folder) => folder.id))
    const folderKey = (folder: Folder) => JSON.stringify([folder.parentId ?? null, folder.name.toLowerCase()])
    const knownFolders = new Map<string, Folder>(rows.folders.result.map((folder: Folder) => [folderKey(folder), folder]))
    const remap = new Map<string, string>()
    for (const original of backup.folders) {
      const folder = { ...original, parentId: original.parentId ? remap.get(original.parentId)! : null }
      const key = folderKey(folder)
      const existing = knownFolders.get(key)
      if (existing) {
        remap.set(original.id, existing.id)
        continue
      }
      if (folderIds.has(folder.id)) folder.id = crypto.randomUUID()
      folderIds.add(folder.id)
      knownFolders.set(key, folder)
      remap.set(original.id, folder.id)
      folderStore.add(folder)
      addedFolders.push(folder)
    }
    const existingGroups: TelegramSubgroup[] = rows.subgroups.result
    const keys = new Set(existingGroups.map((group) => subgroupKey(account, group)))
    const groupIds = new Set(existingGroups.map((group) => group.id))
    const chatIds = new Set(existingGroups.flatMap((group) => 'peer' in group ? [group.peer.chatId] : []))
    for (const original of backup.subgroups) {
      const group = { ...original, albumId: remap.get(original.albumId)! }
      const key = subgroupKey(account, group)
      if (keys.has(key) || groupIds.has(group.id) || ('peer' in group && chatIds.has(group.peer.chatId))) continue
      keys.add(key)
      groupIds.add(group.id)
      if ('peer' in group) chatIds.add(group.peer.chatId)
      prefs.add(group, key)
      importedCount++
    }
    const metadataIds = new Set(rows.metadata.result.map((record: TelegramMetadata) => record.id))
    for (const record of backup.metadata) {
      if (metadataIds.has(record.id)) continue
      const location = telegramMessageLocation(account, record.id)
      if (!location || (location.chatId !== null && !chatIds.has(location.chatId))) continue
      prefs.add({ ...record, folderId: record.folderId ? remap.get(record.folderId)! : null }, record.id)
      importedCount++
    }
  }

  await done
  return { addedFolders, importedCount, skipped: backup.subgroups.length + backup.metadata.length - importedCount }
}
