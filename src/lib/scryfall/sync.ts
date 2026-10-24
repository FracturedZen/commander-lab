import { normalizeCardName, type CardRef } from '@/types/card'
import { getDb, type StoredCardRow } from '@/lib/storage/db'
import { mapScryfallToStored, type ScryfallBulkCard } from './mapCard'

export type SyncProgress = {
  phase: 'meta' | 'download' | 'decompress' | 'index' | 'done' | 'error'
  message: string
  fraction?: number
  bytesReceived?: number
  cardsWritten?: number
  totalCards?: number
}

export type CardDbMeta = {
  bulkType: string
  updatedAt: number
  cardCount: number
  downloadBytes: number
  scryfallUpdatedAt?: string
}

const BULK_API = 'https://api.scryfall.com/bulk-data'
const PREFERRED_BULK = 'oracle_cards'
/** Small batches for mobile Safari IndexedDB quota / transaction limits. */
const WRITE_BATCH = 80

type BulkListItem = {
  type: string
  name: string
  /** Legacy uncompressed JSON (removed by Scryfall ~2026). */
  download_uri?: string
  /** Current: gzipped JSONL. */
  jsonl_download_uri?: string
  size?: number
  compressed_size?: number
  updated_at: string
}

export async function getCardDbMeta(): Promise<CardDbMeta | null> {
  const db = await getDb()
  const row = await db.get('cardMeta', 'sync')
  return (row?.value as CardDbMeta | undefined) ?? null
}

export async function getCardCount(): Promise<number> {
  const db = await getDb()
  return db.count('cards')
}

/**
 * Download Scryfall oracle_cards bulk (gzipped JSONL), strip fields, write IndexedDB.
 * Scryfall (2026+) no longer ships uncompressed `download_uri` JSON arrays —
 * only `jsonl_download_uri` (.jsonl.gz).
 */
export async function syncScryfallCards(
  onProgress?: (p: SyncProgress) => void,
  signal?: AbortSignal,
): Promise<CardDbMeta> {
  const report = (p: SyncProgress) => onProgress?.(p)

  try {
    report({
      phase: 'meta',
      message: 'Fetching Scryfall bulk-data catalog…',
      fraction: 0.02,
    })

    const listRes = await fetch(BULK_API, {
      headers: { Accept: 'application/json' },
      signal,
      cache: 'no-store',
    })
    if (!listRes.ok) {
      throw new Error(
        `Scryfall bulk-data catalog failed: HTTP ${listRes.status} ${listRes.statusText}`,
      )
    }

    // Scryfall asks for ~50–100ms between requests
    await sleep(120, signal)

    const listJson = (await listRes.json()) as { data: BulkListItem[] }
    if (!Array.isArray(listJson.data)) {
      throw new Error('Scryfall bulk-data response missing data[]')
    }

    const item =
      listJson.data.find((d) => d.type === PREFERRED_BULK) ??
      listJson.data.find((d) => d.type === 'default_cards')
    if (!item) {
      throw new Error('No oracle_cards / default_cards bulk entry found')
    }

    const downloadUri = item.jsonl_download_uri ?? item.download_uri
    if (!downloadUri) {
      throw new Error(
        `Bulk entry “${item.type}” has no jsonl_download_uri / download_uri`,
      )
    }

    const isGzipJsonl = Boolean(item.jsonl_download_uri) || /\.jsonl\.gz(\?|$)/i.test(downloadUri)
    const expectedBytes = item.compressed_size ?? item.size ?? 0

    report({
      phase: 'download',
      message: `Downloading ${item.name}${expectedBytes ? ` (~${formatBytes(expectedBytes)})` : ''}…`,
      fraction: 0.05,
    })

    const dlRes = await fetch(downloadUri, {
      signal,
      cache: 'no-store',
    })
    if (!dlRes.ok) {
      throw new Error(
        `Bulk download failed: HTTP ${dlRes.status} ${dlRes.statusText} (${downloadUri})`,
      )
    }

    const contentLength =
      Number(dlRes.headers.get('content-length')) || expectedBytes || 0

    let written = 0
    let downloadBytes = 0

    if (isGzipJsonl) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error(
          'This browser cannot decompress gzip (no DecompressionStream). Try a newer Chrome/Safari/Firefox.',
        )
      }
      if (!dlRes.body) {
        throw new Error('Bulk response has no body stream')
      }

      // Tee progress on the compressed bytes, then decompress → JSONL lines
      const [progressBranch, decodeBranch] = dlRes.body.tee()
      void trackStreamBytes(progressBranch, (received) => {
        downloadBytes = received
        report({
          phase: 'download',
          message: `Downloading… ${formatBytes(received)}${
            contentLength ? ` / ${formatBytes(contentLength)}` : ''
          }`,
          fraction: contentLength
            ? 0.05 + 0.35 * Math.min(1, received / contentLength)
            : 0.2,
          bytesReceived: received,
        })
      }, signal).catch(() => {
        /* progress branch may abort when primary finishes */
      })

      report({
        phase: 'decompress',
        message: 'Decompressing & indexing cards…',
        fraction: 0.4,
      })

      const decompressed = decodeBranch.pipeThrough(new DecompressionStream('gzip'))
      written = await indexJsonlStream(decompressed, (n, approxTotal) => {
        report({
          phase: 'index',
          message: `Indexed ${n.toLocaleString()} cards…`,
          fraction: 0.4 + 0.55 * Math.min(1, n / Math.max(approxTotal, n, 1)),
          cardsWritten: n,
          totalCards: approxTotal > n ? approxTotal : undefined,
          bytesReceived: downloadBytes,
        })
      }, signal)
    } else {
      // Legacy: uncompressed JSON array
      const buffer = await readResponseWithProgress(
        dlRes,
        (received) => {
          downloadBytes = received
          report({
            phase: 'download',
            message: `Downloading… ${formatBytes(received)}${
              contentLength ? ` / ${formatBytes(contentLength)}` : ''
            }`,
            fraction: contentLength
              ? 0.05 + 0.4 * Math.min(1, received / contentLength)
              : 0.2,
            bytesReceived: received,
          })
        },
        signal,
      )
      const text = new TextDecoder().decode(buffer)
      let rawCards: ScryfallBulkCard[]
      try {
        rawCards = JSON.parse(text) as ScryfallBulkCard[]
      } catch (e) {
        throw new Error(
          `Failed to parse Scryfall bulk JSON: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
      if (!Array.isArray(rawCards)) {
        throw new Error('Unexpected bulk JSON shape (expected array)')
      }
      written = await writeCardBatches(rawCards, (n) => {
        report({
          phase: 'index',
          message: `Indexed ${n.toLocaleString()} / ${rawCards.length.toLocaleString()} cards…`,
          fraction: 0.5 + 0.45 * (n / rawCards.length),
          cardsWritten: n,
          totalCards: rawCards.length,
          bytesReceived: downloadBytes,
        })
      }, signal)
    }

    invalidateSearchCache()

    const meta: CardDbMeta = {
      bulkType: item.type,
      updatedAt: Date.now(),
      cardCount: written,
      downloadBytes: downloadBytes || expectedBytes,
      scryfallUpdatedAt: item.updated_at,
    }
    const db = await getDb()
    await db.put('cardMeta', { key: 'sync', value: meta, updatedAt: Date.now() })

    report({
      phase: 'done',
      message: `Synced ${written.toLocaleString()} cards. You can play offline now.`,
      fraction: 1,
      cardsWritten: written,
      totalCards: written,
      bytesReceived: downloadBytes,
    })

    return meta
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    const msg = e instanceof Error ? e.message : String(e)
    report({ phase: 'error', message: msg, fraction: 0 })
    throw e instanceof Error ? e : new Error(msg)
  }
}

async function trackStreamBytes(
  stream: ReadableStream<Uint8Array>,
  onChunk: (received: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const reader = stream.getReader()
  let received = 0
  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        received += value.byteLength
        onChunk(received)
      }
    }
  } finally {
    reader.releaseLock()
  }
  return received
}

/**
 * Parse gzipped-decompressed JSONL, write to IndexedDB in small batches.
 * Clears the cards store once before first write.
 */
async function indexJsonlStream(
  stream: ReadableStream<Uint8Array>,
  onProgress: (written: number, approxTotal: number) => void,
  signal?: AbortSignal,
): Promise<number> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  let batch: ScryfallBulkCard[] = []
  let written = 0
  let cleared = false
  // oracle_cards is typically ~30–40k rows
  const approxTotal = 35000

  const flush = async () => {
    if (batch.length === 0) return
    if (!cleared) {
      const db = await getDb()
      await db.clear('cards')
      cleared = true
    }
    await writeCardBatches(batch, () => {}, signal, { skipClear: true })
    written += batch.length
    batch = []
    onProgress(written, approxTotal)
  }

  try {
    while (true) {
      if (signal?.aborted) {
        await reader.cancel()
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      if (value) {
        pending += decoder.decode(value, { stream: true })
        let nl = pending.indexOf('\n')
        while (nl >= 0) {
          const line = pending.slice(0, nl).trim()
          pending = pending.slice(nl + 1)
          if (line) {
            try {
              batch.push(JSON.parse(line) as ScryfallBulkCard)
            } catch (e) {
              throw new Error(
                `Bad JSONL line near card ${written + batch.length}: ${
                  e instanceof Error ? e.message : String(e)
                }`,
              )
            }
          }
          if (batch.length >= WRITE_BATCH) await flush()
          nl = pending.indexOf('\n')
        }
      }
      if (done) break
    }
    pending += decoder.decode()
    const tail = pending.trim()
    if (tail) {
      try {
        batch.push(JSON.parse(tail) as ScryfallBulkCard)
      } catch (e) {
        throw new Error(
          `Bad final JSONL line: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    }
    await flush()
  } finally {
    reader.releaseLock()
  }

  if (written === 0) {
    throw new Error('No cards parsed from Scryfall JSONL (empty file?)')
  }
  return written
}

async function writeCardBatches(
  rawCards: ScryfallBulkCard[],
  onProgress: (written: number) => void,
  signal?: AbortSignal,
  opts: { skipClear?: boolean } = {},
): Promise<number> {
  const db = await getDb()
  if (!opts.skipClear) {
    await db.clear('cards')
  }

  let written = 0
  for (let i = 0; i < rawCards.length; i += WRITE_BATCH) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const slice = rawCards.slice(i, i + WRITE_BATCH)
    const tx = db.transaction('cards', 'readwrite')
    await Promise.all(slice.map((raw) => tx.store.put(mapScryfallToStored(raw))))
    await tx.done
    written += slice.length
    onProgress(written)
    // Yield to UI / GC on mobile
    if (i % (WRITE_BATCH * 5) === 0) await sleep(0, signal)
  }
  return written
}

async function readResponseWithProgress(
  res: Response,
  onChunk: (received: number) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  if (!res.body) return res.arrayBuffer()
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    if (signal?.aborted) {
      await reader.cancel()
      throw new DOMException('Aborted', 'AbortError')
    }
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      onChunk(received)
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out.buffer
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const t = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new DOMException('Aborted', 'AbortError'))
      },
      { once: true },
    )
  })
}

type SearchEntry = {
  id: string
  name: string
  nameNorm: string
  typeLine?: string
  manaCost?: string
  cmc?: number
  colorIdentity?: string[]
  commanderLegality?: string
  imageSmall?: string
  imageNormal?: string
  oracleId?: string
  oracleText?: string
  set?: string
}

let searchCache: SearchEntry[] | null = null
let searchCachePromise: Promise<SearchEntry[]> | null = null

export function invalidateSearchCache(): void {
  searchCache = null
  searchCachePromise = null
}

async function loadSearchCache(): Promise<SearchEntry[]> {
  if (searchCache) return searchCache
  if (searchCachePromise) return searchCachePromise
  searchCachePromise = (async () => {
    const db = await getDb()
    const all = await db.getAll('cards')
    searchCache = all.map((c: StoredCardRow) => ({
      id: c.id,
      name: c.name,
      nameNorm: c.nameNorm || normalizeCardName(c.name),
      typeLine: c.typeLine,
      manaCost: c.manaCost,
      cmc: c.cmc,
      colorIdentity: c.colorIdentity,
      commanderLegality: c.commanderLegality,
      imageSmall: c.imageSmall,
      imageNormal: c.imageNormal,
      oracleId: c.oracleId,
      oracleText: c.oracleText,
      set: c.set,
    }))
    return searchCache
  })()
  return searchCachePromise
}

export async function searchCards(
  query: string,
  opts: {
    limit?: number
    commandersOnly?: boolean
    withinColorIdentity?: string[]
  } = {},
): Promise<CardRef[]> {
  const q = normalizeCardName(query)
  if (!q) return []
  const limit = opts.limit ?? 40
  const cache = await loadSearchCache()
  const tokens = q.split(/\s+/).filter(Boolean)
  const ciAllow = opts.withinColorIdentity
    ? new Set(opts.withinColorIdentity)
    : null

  const scored: { card: SearchEntry; score: number }[] = []
  for (const c of cache) {
    if (opts.commandersOnly) {
      const tl = c.typeLine ?? ''
      if (!tl.includes('Legendary')) continue
    }
    if (ciAllow) {
      const cardCi = c.colorIdentity ?? []
      if (cardCi.some((col) => !ciAllow.has(col))) continue
    }

    let score = 0
    if (c.nameNorm === q) score = 1000
    else if (c.nameNorm.startsWith(q)) score = 800
    else if (c.nameNorm.includes(q)) score = 500
    else if (tokens.every((t) => c.nameNorm.includes(t))) score = 300
    else continue

    if (c.commanderLegality === 'legal') score += 5
    scored.push({ card: c, score })
  }

  scored.sort(
    (a, b) => b.score - a.score || a.card.name.localeCompare(b.card.name),
  )
  return scored.slice(0, limit).map(({ card }) => entryToRef(card))
}

export async function getCardById(id: string): Promise<CardRef | undefined> {
  const db = await getDb()
  const row = await db.get('cards', id)
  return row ? stripNameNorm(row) : undefined
}

export async function getCardByName(
  exactName: string,
): Promise<CardRef | undefined> {
  const cleaned = exactName
    .replace(/\s*\[[^\]]*]\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  const norm = normalizeCardName(cleaned)

  const db = await getDb()
  const byName = await db.getAllFromIndex('cards', 'by-name', cleaned)
  if (byName[0]) return stripNameNorm(byName[0])

  const cache = await loadSearchCache()
  const hit = cache.find((c) => c.nameNorm === norm)
  if (hit) return entryToRef(hit)

  const front = norm.split(' // ')[0]?.trim()
  if (front && front !== norm) {
    const hit2 = cache.find(
      (c) => c.nameNorm === front || c.nameNorm.startsWith(`${front} //`),
    )
    if (hit2) return entryToRef(hit2)
  }
  return undefined
}

function entryToRef(c: SearchEntry): CardRef {
  return {
    id: c.id,
    oracleId: c.oracleId,
    name: c.name,
    set: c.set,
    typeLine: c.typeLine,
    manaCost: c.manaCost,
    cmc: c.cmc,
    colorIdentity: c.colorIdentity,
    commanderLegality: c.commanderLegality,
    imageSmall: c.imageSmall,
    imageNormal: c.imageNormal,
    oracleText: c.oracleText,
  }
}

function stripNameNorm(row: StoredCardRow): CardRef {
  const { nameNorm: _n, ...rest } = row
  void _n
  return rest
}
