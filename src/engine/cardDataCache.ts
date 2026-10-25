import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { PHASE_CDN, PHASE_LOCAL, type PhaseLocalManifest } from './config'
import {
  fetchBytesWithProgress,
  formatBytes,
  stageOverall,
  type BootProgressCb,
} from './bootProgress'
import { yieldForPaint, yieldIdle, yieldToMain } from './bootYield'

/** Uncompressed JSON size (~95.4 MiB). Wire is ~7.1 MB brotli from CDN. */
export const CARD_DATA_DECODED_BYTES = 100_074_660
export const CARD_DATA_WIRE_BR_BYTES = 7_463_919

interface PhaseCardDb extends DBSchema {
  meta: {
    key: string
    value: { key: string; hash: string; url: string; fetchedAt: number }
  }
  blobs: {
    key: string
    value: { key: string; text?: string; buffer?: ArrayBuffer }
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

const DECODE_CHUNK = 2 * 1024 * 1024 // 2 MiB

/**
 * UTF-8 decode in chunks with idle yields so the UI can paint mid-decode.
 * Final join still allocates one big string (Phase needs a JSON string).
 */
export async function bytesToUtf8Yielding(
  buf: ArrayBuffer,
  onChunk?: (decodedBytes: number, totalBytes: number) => void,
): Promise<string> {
  const view = new Uint8Array(buf)
  const total = view.byteLength
  if (total === 0) return ''
  // Small payloads: one-shot
  if (total <= DECODE_CHUNK) {
    onChunk?.(total, total)
    return new TextDecoder('utf-8').decode(view)
  }
  const decoder = new TextDecoder('utf-8')
  const parts: string[] = []
  for (let offset = 0; offset < total; ) {
    const end = Math.min(offset + DECODE_CHUNK, total)
    const slice = view.subarray(offset, end)
    const last = end >= total
    parts.push(decoder.decode(slice, { stream: !last }))
    offset = end
    onChunk?.(offset, total)
    if (!last) await yieldIdle(32)
  }
  await yieldToMain()
  // join is sync/allocating — caller should have painted "Assembling JSON string…"
  return parts.join('')
}

async function resolveCardDataSource(): Promise<{
  hash: string
  url: string
  from: 'phase-local' | 'cdn'
}> {
  const base = import.meta.env.BASE_URL
  try {
    const manRes = await fetch(`${base}${PHASE_LOCAL.manifestPath}`, { cache: 'no-cache' })
    if (manRes.ok) {
      const man = (await manRes.json()) as PhaseLocalManifest
      const file = man.cardDataFile || PHASE_LOCAL.cardDataPath.replace(/^phase\//, '')
      const hash = man.cardDataHash
      if (hash && file) {
        const localPath = `${base}phase/${file}`
        const probe = await fetch(localPath, { method: 'HEAD' })
        if (probe.ok) {
          const origin = typeof window !== 'undefined' ? window.location.origin : ''
          return {
            hash,
            url: origin ? new URL(localPath, origin).href : localPath,
            from: 'phase-local',
          }
        }
      }
    }
  } catch {
    /* CDN */
  }
  return { hash: PHASE_CDN.cardDataHash, url: PHASE_CDN.cardDataUrl, from: 'cdn' }
}

/**
 * Resolve Phase card-data.json text pinned to the WASM build we ship against.
 * Prefer public/phase (fork build) when manifest + file exist; else IndexedDB
 * cache matching the active hash; else download (CDN brotli ~7 MB wire).
 * Keeps v1 text blobs working for “Already cached — instant”.
 */
export async function loadPhaseCardDataText(
  onProgress?: BootProgressCb,
): Promise<{ text: string; hash: string; fromCache: boolean }> {
  const resolved = await resolveCardDataSource()
  const hash = resolved.hash
  const url = resolved.url
  if (resolved.from === 'phase-local') {
    onProgress?.({
      stage: 'card-data',
      message: `Card-data source: local Phase fork (${hash})…`,
      fraction: stageOverall('card-data', 0.02),
      stageFraction: 0.02,
    })
  }

  await yieldToMain()
  const database = await db()
  const cached = await database.get('meta', 'card-data')
  if (cached?.hash === hash) {
    onProgress?.({
      stage: 'card-data',
      message: 'Reading cached card-data from IndexedDB…',
      fraction: stageOverall('card-data', 0.05),
      stageFraction: 0.05,
      fromCache: true,
    })
    await yieldToMain()
    const blob = await database.get('blobs', 'card-data')
    if (blob?.text) {
      onProgress?.({
        stage: 'card-data',
        message: `Cached card-data ready (${hash})`,
        fraction: stageOverall('card-data', 1),
        stageFraction: 1,
        fromCache: true,
      })
      await yieldForPaint()
      return { text: blob.text, hash, fromCache: true }
    }
    if (blob?.buffer && blob.buffer.byteLength > 0) {
      onProgress?.({
        stage: 'card-data',
        message: 'Decoding cached card-data…',
        fraction: stageOverall('card-data', 0.2),
        stageFraction: 0.2,
        fromCache: true,
        bytesReceived: 0,
        bytesTotal: blob.buffer.byteLength,
      })
      await yieldForPaint()
      const text = await bytesToUtf8Yielding(blob.buffer, (done, total) => {
        const stageFraction = 0.2 + 0.75 * (done / total)
        onProgress?.({
          stage: 'card-data',
          message: `Decoding cached card-data… ${formatBytes(done)} / ${formatBytes(total)}`,
          fraction: stageOverall('card-data', stageFraction),
          stageFraction,
          fromCache: true,
          bytesReceived: done,
          bytesTotal: total,
        })
      })
      onProgress?.({
        stage: 'card-data',
        message: `Cached card-data ready (${hash})`,
        fraction: stageOverall('card-data', 1),
        stageFraction: 1,
        fromCache: true,
      })
      await yieldForPaint()
      return { text, hash, fromCache: true }
    }
  }

  onProgress?.({
    stage: 'card-data',
    message: `Downloading card-data (${hash}, ~${formatBytes(CARD_DATA_WIRE_BR_BYTES)} br → ~${formatBytes(CARD_DATA_DECODED_BYTES)})…`,
    fraction: stageOverall('card-data', 0),
    stageFraction: 0,
    bytesReceived: 0,
    bytesTotal: null,
  })
  await yieldForPaint()

  const bytes = await fetchBytesWithProgress(url, (received, total) => {
    // Browser decompresses br; content-length is often the compressed size.
    // Prefer decoded progress when received exceeds declared total.
    const displayTotal =
      total && received <= total * 1.05 ? total : CARD_DATA_DECODED_BYTES
    const stageFraction = Math.min(0.55, (received / displayTotal) * 0.55)
    onProgress?.({
      stage: 'card-data',
      message:
        total && received <= total * 1.05
          ? `Downloading card-data… ${formatBytes(received)} / ${formatBytes(total)} (wire; br)`
          : `Downloading card-data… ${formatBytes(received)} decoded`,
      fraction: stageOverall('card-data', stageFraction || (received > 0 ? 0.15 : 0)),
      stageFraction: stageFraction || undefined,
      bytesReceived: received,
      bytesTotal: displayTotal,
    })
  })

  onProgress?.({
    stage: 'card-data',
    message: 'Decoding card-data JSON (chunked)…',
    fraction: stageOverall('card-data', 0.58),
    stageFraction: 0.58,
    bytesReceived: 0,
    bytesTotal: bytes.byteLength,
  })
  await yieldForPaint()

  const text = await bytesToUtf8Yielding(bytes, (done, total) => {
    const stageFraction = 0.58 + 0.3 * (done / total)
    onProgress?.({
      stage: 'card-data',
      message: `Decoding card-data… ${formatBytes(done)} / ${formatBytes(total)}`,
      fraction: stageOverall('card-data', stageFraction),
      stageFraction,
      bytesReceived: done,
      bytesTotal: total,
    })
  })

  onProgress?.({
    stage: 'card-data',
    message: 'Caching card-data in IndexedDB (binary)…',
    fraction: stageOverall('card-data', 0.92),
    stageFraction: 0.92,
    bytesReceived: bytes.byteLength,
    bytesTotal: bytes.byteLength,
  })
  await yieldToMain()
  // Store ArrayBuffer (not the huge JS string) for cheaper IDB writes / future reads.
  await database.put('blobs', { key: 'card-data', buffer: bytes })
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
  await yieldForPaint()
  return { text, hash, fromCache: false }
}

/** True when IndexedDB holds the pinned card-data hash (instant card-data stage). */
export async function hasCachedPhaseCardData(): Promise<boolean> {
  try {
    const database = await db()
    const cached = await database.get('meta', 'card-data')
    if (cached?.hash !== PHASE_CDN.cardDataHash) return false
    const blob = await database.get('blobs', 'card-data')
    return Boolean(blob?.text || (blob?.buffer && blob.buffer.byteLength > 0))
  } catch {
    return false
  }
}
