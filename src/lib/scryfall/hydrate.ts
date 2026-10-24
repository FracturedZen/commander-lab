/**
 * Re-attach Scryfall art + oracle fields onto deck/table CardRefs that were
 * saved as stubs or pre-sync snapshots without image URLs.
 */
import { normalizeCardName, type CardRef } from '@/types/card'
import { getDb, type StoredCardRow } from '@/lib/storage/db'
import { getCardById, getCardByName } from './sync'

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

export async function hydrateCardRef(card: CardRef): Promise<CardRef> {
  if (!needsArt(card) && !needsOracle(card)) return card
  try {
    const synced = await lookupSynced(card)
    if (!synced) return card
    return mergeHydrated(card, synced)
  } catch {
    return card
  }
}

/**
 * Batch-hydrate CardRefs. Builds one name/oracle map from IndexedDB for the
 * keys we need so a 99-card deck does not hammer the store.
 */
export async function hydrateCardRefs(cards: CardRef[]): Promise<CardRef[]> {
  if (cards.length === 0) return cards

  const needLookup = cards.some((c) => needsArt(c) || needsOracle(c))
  if (!needLookup) return cards

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

  // Prefer targeted index reads; fall back to a single full scan if many misses
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

  // Name fallback for stubs — one scan of by-name-norm for remaining
  const missingNames = [...nameKeys].filter((n) => !byNameNorm.has(n))
  if (missingNames.length > 0) {
    const missingSet = new Set(missingNames)
    try {
      // Bound: if few names left, use getCardByName; if many, scan once
      if (missingSet.size <= 8) {
        for (const n of missingSet) {
          // Re-resolve via name helper (uses search cache after warm)
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

  return cards.map((card) => {
    if (!needsArt(card) && !needsOracle(card)) return card
    const synced =
      (card.oracleId ? byOracle.get(card.oracleId) : undefined) ??
      byId.get(card.id) ??
      byNameNorm.get(normalizeCardName(card.name))
    return synced ? mergeHydrated(card, synced) : card
  })
}
