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
  image_uris?: { small?: string; normal?: string }
  card_faces?: Array<{
    mana_cost?: string
    type_line?: string
    oracle_text?: string
    colors?: string[]
    image_uris?: { small?: string; normal?: string }
    power?: string
    toughness?: string
  }>
  power?: string
  toughness?: string
  layout?: string
}

export function mapScryfallToStored(raw: ScryfallBulkCard): StoredCardRow {
  const face0 = raw.card_faces?.[0]
  const imageSmall =
    raw.image_uris?.small ?? face0?.image_uris?.small ?? undefined
  const imageNormal =
    raw.image_uris?.normal ?? face0?.image_uris?.normal ?? undefined

  const base: CardRef = {
    id: raw.id,
    oracleId: raw.oracle_id,
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
    imageSmall,
    imageNormal,
    power: raw.power ?? face0?.power,
    toughness: raw.toughness ?? face0?.toughness,
    layout: raw.layout,
  }

  return {
    ...base,
    nameNorm: normalizeCardName(raw.name),
  }
}
