import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { PHASE_CDN } from './config'
import {
  bytesToUtf8,
  fetchBytesWithProgress,
  formatBytes,
  stageOverall,
  type BootProgressCb,
} from './bootProgress'

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

/**
 * Resolve Phase card-data.json text pinned to the WASM build we ship against.
 * Prefer IndexedDB cache matching PHASE_CDN.cardDataHash; otherwise download
 * with byte progress. (Staging card-data-meta.json can point at a newer dump
 * the WASM cannot parse.)
 */
export async function loadPhaseCardDataText(
  onProgress?: BootProgressCb,
): Promise<{ text: string; hash: string; fromCache: boolean }> {
  const hash = PHASE_CDN.cardDataHash
  const url = PHASE_CDN.cardDataUrl

  const database = await db()
  const cached = await database.get('meta', 'card-data')
  if (cached?.hash === hash) {
    const blob = await database.get('blobs', 'card-data')
    if (blob?.text) {
      onProgress?.({
        stage: 'card-data',
        message: `Using cached card-data (${hash})`,
        fraction: stageOverall('card-data', 1),
        stageFraction: 1,
        fromCache: true,
      })
      return { text: blob.text, hash, fromCache: true }
    }
  }

  onProgress?.({
    stage: 'card-data',
    message: `Downloading card-data (${hash}, ~96 MB)…`,
    fraction: stageOverall('card-data', 0),
    stageFraction: 0,
    bytesReceived: 0,
    bytesTotal: null,
  })

  const bytes = await fetchBytesWithProgress(url, (received, total) => {
    const stageFraction = total && total > 0 ? Math.min(1, received / total) : 0
    onProgress?.({
      stage: 'card-data',
      message:
        total && total > 0
          ? `Downloading card-data… ${formatBytes(received)} / ${formatBytes(total)}`
          : `Downloading card-data… ${formatBytes(received)}`,
      fraction: stageOverall('card-data', stageFraction || (received > 0 ? 0.5 : 0)),
      stageFraction: stageFraction || undefined,
      bytesReceived: received,
      bytesTotal: total,
    })
  })

  const text = bytesToUtf8(bytes)
  onProgress?.({
    stage: 'card-data',
    message: 'Caching card-data in IndexedDB…',
    fraction: stageOverall('card-data', 0.95),
    stageFraction: 0.95,
    bytesReceived: bytes.byteLength,
    bytesTotal: bytes.byteLength,
  })
  await database.put('blobs', { key: 'card-data', text })
  await database.put('meta', {
    key: 'card-data',
    hash,
    url,
    fetchedAt: Date.now(),
  })
  onProgress?.({
    stage: 'card-data',
    message: `Card-data ready (${hash})`,
    fraction: stageOverall('card-data', 1),
    stageFraction: 1,
  })
  return { text, hash, fromCache: false }
}

/** True when IndexedDB holds the pinned card-data hash (instant card-data stage). */
export async function hasCachedPhaseCardData(): Promise<boolean> {
  try {
    const database = await db()
    const cached = await database.get('meta', 'card-data')
    if (cached?.hash !== PHASE_CDN.cardDataHash) return false
    const blob = await database.get('blobs', 'card-data')
    return Boolean(blob?.text)
  } catch {
    return false
  }
}
