/**
 * Re-attach Scryfall art + oracle fields onto deck/table CardRefs that were
 * saved as stubs or pre-sync snapshots without image URLs.
 */
import { normalizeCardName, type CardRef } from '@/types/card'
import { getDb, type StoredCardRow } from '@/lib/storage/db'
import { getCardById, getCardByName, invalidateSearchCache } from './sync'
import { mapScryfallToStored, type ScryfallBulkCard } from './mapCard'

function stripNameNorm(row: StoredCardRow): CardRef {
  const { nameNorm: _n, ...rest } = row
  void _n
  return rest
}

function needsArt(card: CardRef): boolean {
  return !(card.imageNormal || card.imageLarge || card.imageSmall)
}

function needsOracle(card: CardRef): boolean {
  return !(card.oracleText && card.typeLine)
}

/**
 * Do NOT synthesize CDN URLs from oracle_id / stored id — after sync the
 * primary key is oracle_id, which is a UUID but not a printing id (404s).
 * CDN synthesis happens only in mapCard from the printing UUID at sync time.
 */
export function attachCdnIfPossible(card: CardRef): CardRef {
  return card
}

/** Merge synced row into a deck/table stub, preferring synced art. */
export function mergeHydrated(stub: CardRef, synced: CardRef): CardRef {
  return {
    ...stub,
    id: synced.id || stub.id,
    oracleId: synced.oracleId ?? stub.oracleId,
    name: synced.name || stub.name,
    set: synced.set ?? stub.set,
    collectorNumber: synced.collectorNumber ?? stub.collectorNumber,
    manaCost: synced.manaCost ?? stub.manaCost,
    cmc: synced.cmc ?? stub.cmc,
    typeLine: synced.typeLine ?? stub.typeLine,
    oracleText: synced.oracleText ?? stub.oracleText,
    colors: synced.colors ?? stub.colors,
    colorIdentity: synced.colorIdentity ?? stub.colorIdentity,
    keywords: synced.keywords ?? stub.keywords,
    commanderLegality: synced.commanderLegality ?? stub.commanderLegality,
    imageSmall: synced.imageSmall ?? stub.imageSmall,
    imageNormal: synced.imageNormal ?? stub.imageNormal,
    imageLarge: synced.imageLarge ?? stub.imageLarge,
    power: synced.power ?? stub.power,
    toughness: synced.toughness ?? stub.toughness,
    layout: synced.layout ?? stub.layout,
    // Keep deck-list flags/qty from the stub
    isCommander: stub.isCommander ?? synced.isCommander,
    quantity: stub.quantity,
  }
}

async function lookupSynced(card: CardRef): Promise<CardRef | undefined> {
  if (card.oracleId) {
    const byOracle = await getCardByOracleId(card.oracleId)
    if (byOracle) return byOracle
  }
  if (card.id && !card.id.startsWith('stub:')) {
    const byId = await getCardById(card.id)
    if (byId) return byId
  }
  return getCardByName(card.name)
}

export async function getCardByOracleId(
  oracleId: string,
): Promise<CardRef | undefined> {
  const db = await getDb()
  const rows = await db.getAllFromIndex('cards', 'by-oracle', oracleId)
  if (rows[0]) return stripNameNorm(rows[0])
  // Primary key is often oracle_id after v3 rekey
  return getCardById(oracleId)
}

let namedQueue: Promise<void> = Promise.resolve()
let lastNamedAt = 0

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Live Scryfall named lookup (rate-limited). Caches into IndexedDB when possible.
 * Prefer bulk re-sync; this is a safety net for stubs / old oracle-only rows.
 */
export async function fetchNamedCardLive(
  exactName: string,
): Promise<CardRef | undefined> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return undefined
  const cleaned = exactName
    .replace(/\s*\[[^\]]*]\s*$/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  if (!cleaned) return undefined

  const run = namedQueue.then(async () => {
    const wait = Math.max(0, 110 - (Date.now() - lastNamedAt))
    if (wait) await sleep(wait)
    lastNamedAt = Date.now()
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cleaned)}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return undefined
    const raw = (await res.json()) as ScryfallBulkCard
    const stored = mapScryfallToStored(raw)
    try {
      const db = await getDb()
      await db.put('cards', stored)
      invalidateSearchCache()
    } catch {
      /* quota / private mode — still return the ref */
    }
    return stripNameNorm(stored)
  })
  namedQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function hydrateCardRef(card: CardRef): Promise<CardRef> {
  let next = attachCdnIfPossible(card)
  if (!needsArt(next) && !needsOracle(next)) return next
  try {
    const synced = await lookupSynced(next)
    if (synced) {
      next = attachCdnIfPossible(mergeHydrated(next, synced))
    }
  } catch {
    /* ignore */
  }
  if (needsArt(next) && typeof navigator !== 'undefined' && navigator.onLine) {
    try {
      const live = await fetchNamedCardLive(next.name)
      if (live) next = attachCdnIfPossible(mergeHydrated(next, live))
    } catch {
      /* ignore */
    }
  }
  return next
}

/**
 * Batch-hydrate CardRefs. Builds one name/oracle map from IndexedDB for the
 * keys we need so a 99-card deck does not hammer the store.
 * Live named API only for remaining art misses (capped + rate-limited).
 */
export async function hydrateCardRefs(cards: CardRef[]): Promise<CardRef[]> {
  if (cards.length === 0) return cards

  const needLookup = cards.some((c) => needsArt(c) || needsOracle(c))
  if (!needLookup) return cards.map(attachCdnIfPossible)

  const db = await getDb()
  const byOracle = new Map<string, CardRef>()
  const byId = new Map<string, CardRef>()
  const byNameNorm = new Map<string, CardRef>()

  const oracleKeys = new Set<string>()
  const idKeys = new Set<string>()
  const nameKeys = new Set<string>()

  for (const c of cards) {
    if (!(needsArt(c) || needsOracle(c))) continue
    if (c.oracleId) oracleKeys.add(c.oracleId)
    if (c.id && !c.id.startsWith('stub:')) idKeys.add(c.id)
    nameKeys.add(normalizeCardName(c.name))
  }

  for (const oid of oracleKeys) {
    try {
      const rows = await db.getAllFromIndex('cards', 'by-oracle', oid)
      if (rows[0]) {
        const ref = stripNameNorm(rows[0])
        byOracle.set(oid, ref)
        byId.set(ref.id, ref)
        byNameNorm.set(normalizeCardName(ref.name), ref)
      } else {
        const row = await db.get('cards', oid)
        if (row) {
          const ref = stripNameNorm(row)
          byOracle.set(oid, ref)
          byId.set(ref.id, ref)
          byNameNorm.set(normalizeCardName(ref.name), ref)
        }
      }
    } catch {
      /* ignore */
    }
  }

  for (const id of idKeys) {
    if (byId.has(id) || byOracle.has(id)) continue
    try {
      const row = await db.get('cards', id)
      if (row) {
        const ref = stripNameNorm(row)
        byId.set(id, ref)
        if (ref.oracleId) byOracle.set(ref.oracleId, ref)
        byNameNorm.set(normalizeCardName(ref.name), ref)
      }
    } catch {
      /* ignore */
    }
  }

  const missingNames = [...nameKeys].filter((n) => !byNameNorm.has(n))
  if (missingNames.length > 0) {
    const missingSet = new Set(missingNames)
    try {
      if (missingSet.size <= 8) {
        for (const n of missingSet) {
          const sample = cards.find(
            (c) => normalizeCardName(c.name) === n,
          )
          if (!sample) continue
          const synced = await getCardByName(sample.name)
          if (synced) {
            byNameNorm.set(n, synced)
            byId.set(synced.id, synced)
            if (synced.oracleId) byOracle.set(synced.oracleId, synced)
          }
        }
      } else {
        let cursor = await db
          .transaction('cards')
          .store.index('by-name-norm')
          .openCursor()
        while (cursor) {
          const norm = cursor.value.nameNorm
          if (missingSet.has(norm) && !byNameNorm.has(norm)) {
            const ref = stripNameNorm(cursor.value)
            byNameNorm.set(norm, ref)
            byId.set(ref.id, ref)
            if (ref.oracleId) byOracle.set(ref.oracleId, ref)
            missingSet.delete(norm)
            if (missingSet.size === 0) break
          }
          cursor = await cursor.continue()
        }
      }
    } catch {
      /* offline / empty DB */
    }
  }

  let out = cards.map((card) => {
    let next = attachCdnIfPossible(card)
    if (!needsArt(next) && !needsOracle(next)) return next
    const synced =
      (card.oracleId ? byOracle.get(card.oracleId) : undefined) ??
      byId.get(card.id) ??
      byNameNorm.get(normalizeCardName(card.name))
    return synced
      ? attachCdnIfPossible(mergeHydrated(next, synced))
      : next
  })

  // Live named fallback for art still missing — cap to avoid hammering Scryfall.
  const LIVE_CAP = 12
  if (typeof navigator === 'undefined' || !navigator.onLine) return out

  const needLive = out
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => needsArt(c))
    .slice(0, LIVE_CAP)

  for (const { c, i } of needLive) {
    try {
      const live = await fetchNamedCardLive(c.name)
      if (live) out[i] = attachCdnIfPossible(mergeHydrated(c, live))
    } catch {
      /* ignore */
    }
  }

  return out
}
