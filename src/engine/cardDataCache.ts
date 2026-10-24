import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { PHASE_CDN } from './config'

interface PhaseCardDb extends DBSchema {
  meta: {
    key: string
    value: { key: string; hash: string; url: string; fetchedAt: number }
  }
  blobs: {
    key: string
    value: { key: string; text: string }
  }
}

let dbPromise: Promise<IDBPDatabase<PhaseCardDb>> | null = null

function db() {
  if (!dbPromise) {
    dbPromise = openDB<PhaseCardDb>('commander-lab-phase', 1, {
      upgrade(database) {
        database.createObjectStore('meta', { keyPath: 'key' })
        database.createObjectStore('blobs', { keyPath: 'key' })
      },
    })
  }
  return dbPromise
}

export type CardDataProgress = (msg: string) => void

/**
 * Resolve Phase card-data.json text pinned to the WASM build we ship against.
 * Prefer IndexedDB cache matching PHASE_CDN.cardDataHash; otherwise download.
 * (Staging card-data-meta.json can point at a newer dump the WASM cannot parse.)
 */
export async function loadPhaseCardDataText(
  onProgress?: CardDataProgress,
): Promise<{ text: string; hash: string; fromCache: boolean }> {
  const hash = PHASE_CDN.cardDataHash
  const url = PHASE_CDN.cardDataUrl

  const database = await db()
  const cached = await database.get('meta', 'card-data')
  if (cached?.hash === hash) {
    const blob = await database.get('blobs', 'card-data')
    if (blob?.text) {
      onProgress?.(`Using cached card-data (${hash})`)
      return { text: blob.text, hash, fromCache: true }
    }
  }

  onProgress?.(`Downloading card-data (${hash}, ~96 MB)…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`card-data HTTP ${res.status}`)
  const text = await res.text()
  onProgress?.('Caching card-data in IndexedDB…')
  await database.put('blobs', { key: 'card-data', text })
  await database.put('meta', {
    key: 'card-data',
    hash,
    url,
    fetchedAt: Date.now(),
  })
  return { text, hash, fromCache: false }
}
