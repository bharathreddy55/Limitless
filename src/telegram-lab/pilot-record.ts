export const pilotFileSize = 65536

export interface PilotRecord {
  name: string
  sha256: string
  accountProof: string
  id?: number
}

const STORE = 'uploads'
const SLOT = 'production-pilot'

async function withStore<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open('limitless-pilot', 1)
    opening.onupgradeneeded = () => opening.result.createObjectStore(STORE)
    opening.onsuccess = () => resolve(opening.result)
    opening.onerror = () => reject(opening.error)
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const result = request(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(result.result)
      tx.onabort = () => reject(result.error ?? tx.error ?? new Error('Could not write the pilot record.'))
    })
  } finally {
    db.close()
  }
}

export function readPilotRecord(): Promise<PilotRecord | undefined> {
  return withStore('readonly', (store) => store.get(SLOT))
}

export function reservePilotUpload(record: PilotRecord) {
  // add, rather than put, keeps two tabs from reserving the same slot.
  return withStore('readwrite', (store) => store.add(record, SLOT))
}

export function confirmPilotUpload(record: PilotRecord & { id: number }) {
  return withStore('readwrite', (store) => store.put(record, SLOT))
}
