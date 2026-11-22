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

export type TelegramMetadata = { id: string; folderId: string | null; favorite: boolean }
export type TelegramChatAddress = { chatId: number; channelId: number }
export type TelegramSubgroup = { id: string; albumId: string; name: string } & (
  | { state: 'draft' }
  | { state: 'pending'; title: string }
  | { state: 'created' | 'archived'; title: string; peer: TelegramChatAddress }
)

async function readPreferences<T>(prefix: string): Promise<T[]> {
  const db = await openDatabase()
  const tx = db.transaction('preferences')
  const done = committed(tx)
  const records = tx.objectStore('preferences').getAll(IDBKeyRange.bound(prefix, prefix + '\uffff'))
  await done
  return records.result
}

export const readTelegramMetadata = (account: number) => readPreferences<TelegramMetadata>(`telegram:${account}:`)
const subgroupPrefix = (account: number) => `telegram-subgroup:${account}:`
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

export async function patchTelegramMetadata(id: string, change: Partial<Omit<TelegramMetadata, 'id'>>, defaultFolderId: string | null) {
  const db = await openDatabase()
  const tx = db.transaction('preferences', 'readwrite')
  const done = committed(tx)
  const store = tx.objectStore('preferences')
  const lookup = store.get(id)
  let updated: TelegramMetadata | undefined
  lookup.onsuccess = () => {
    updated = { folderId: defaultFolderId, favorite: false, ...lookup.result, ...change, id }
    store.put(updated, id)
  }
  await done
  if (!updated) throw new Error('Could not update Telegram metadata.')
  return updated
}
