import { normalizeCardName, type CardRef } from '@/types/card'
import type { StoredCardRow } from '@/lib/storage/db'

/** Minimal Scryfall card shape we care about from bulk JSON. */
export type ScryfallBulkCard = {
  id: string
  oracle_id?: string
  name: string
  set?: string
  collector_number?: string
  mana_cost?: string
  cmc?: number
  type_line?: string
  oracle_text?: string
  colors?: string[]
  color_identity?: string[]
  keywords?: string[]
  legalities?: { commander?: string }
  digital?: boolean
  released_at?: string
  image_uris?: { small?: string; normal?: string; large?: string }
  card_faces?: Array<{
    id?: string
    mana_cost?: string
    type_line?: string
    oracle_text?: string
    colors?: string[]
    image_uris?: { small?: string; normal?: string; large?: string }
    power?: string
    toughness?: string
  }>
  power?: string
  toughness?: string
  layout?: string
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Scryfall CDN when bulk omits image_uris but we have a printing UUID. */
export function scryfallCdnUrls(
  printingId: string,
  face: 'front' | 'back' = 'front',
): { small: string; normal: string; large: string } | undefined {
  if (!UUID_RE.test(printingId)) return undefined
  const a = printingId[0]
  const b = printingId[1]
  const base = `https://cards.scryfall.io`
  return {
    small: `${base}/small/${face}/${a}/${b}/${printingId}.jpg`,
    normal: `${base}/normal/${face}/${a}/${b}/${printingId}.jpg`,
    large: `${base}/large/${face}/${a}/${b}/${printingId}.jpg`,
  }
}

function printingIdForArt(raw: ScryfallBulkCard): string | undefined {
  const face0 = raw.card_faces?.[0]
  if (face0?.id && UUID_RE.test(face0.id)) return face0.id
  if (raw.id && UUID_RE.test(raw.id)) return raw.id
  return undefined
}

function faceImages(raw: ScryfallBulkCard) {
  const face0 = raw.card_faces?.[0]
  let imageSmall =
    raw.image_uris?.small ?? face0?.image_uris?.small ?? undefined
  let imageNormal =
    raw.image_uris?.normal ??
    face0?.image_uris?.normal ??
    raw.image_uris?.large ??
    face0?.image_uris?.large ??
    undefined
  let imageLarge =
    raw.image_uris?.large ?? face0?.image_uris?.large ?? undefined

  if (!imageSmall && !imageNormal && !imageLarge) {
    const pid = printingIdForArt(raw)
    if (pid) {
      const cdn = scryfallCdnUrls(pid, 'front')
      if (cdn) {
        imageSmall = cdn.small
        imageNormal = cdn.normal
        imageLarge = cdn.large
      }
    }
  }

  return { imageSmall, imageNormal, imageLarge }
}

/**
 * One IndexedDB row per oracle card. Prefer oracle_id as the primary key so
 * reprint arts never duplicate in search or table resolution.
 * Image URLs come from the chosen printing (default_cards / unique_artwork).
 */
export function mapScryfallToStored(raw: ScryfallBulkCard): StoredCardRow {
  const face0 = raw.card_faces?.[0]
  const images = faceImages(raw)
  const oracleKey = raw.oracle_id ?? raw.id

  const base: CardRef = {
    id: oracleKey,
    oracleId: raw.oracle_id ?? oracleKey,
    name: raw.name,
    set: raw.set,
    collectorNumber: raw.collector_number,
    manaCost: raw.mana_cost ?? face0?.mana_cost,
    cmc: typeof raw.cmc === 'number' ? raw.cmc : undefined,
    typeLine: raw.type_line ?? face0?.type_line,
    oracleText: raw.oracle_text ?? face0?.oracle_text,
    colors: raw.colors ?? face0?.colors,
    colorIdentity: raw.color_identity ?? [],
    keywords: raw.keywords,
    commanderLegality: raw.legalities?.commander,
    imageSmall: images.imageSmall,
    imageNormal: images.imageNormal,
    imageLarge: images.imageLarge,
    power: raw.power ?? face0?.power,
    toughness: raw.toughness ?? face0?.toughness,
    layout: raw.layout,
  }

  return {
    ...base,
    nameNorm: normalizeCardName(raw.name),
  }
}

/** Score a printing when collapsing default_cards reprints to one art. */
export function printingPreferenceScore(raw: ScryfallBulkCard): number {
  const images = faceImages(raw)
  let score = 0
  if (images.imageNormal || images.imageLarge) score += 100
  if (images.imageSmall) score += 10
  if (!raw.digital) score += 50
  // Prefer newer printings
  if (raw.released_at) {
    const t = Date.parse(raw.released_at)
    if (!Number.isNaN(t)) score += Math.floor(t / 86_400_000) / 10_000
  }
  return score
}

/**
 * Collapse many printings to one row per oracle_id (or scryfall id if missing).
 * Keeps the highest-scoring printing.
 */
export function dedupeByOracle(
  rawCards: ScryfallBulkCard[],
): ScryfallBulkCard[] {
  const best = new Map<string, { raw: ScryfallBulkCard; score: number }>()
  for (const raw of rawCards) {
    const key = raw.oracle_id ?? raw.id
    const score = printingPreferenceScore(raw)
    const prev = best.get(key)
    if (!prev || score > prev.score) best.set(key, { raw, score })
  }
  return [...best.values()].map((v) => v.raw)
}
