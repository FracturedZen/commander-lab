import krenkoJson from '@/data/sample-decks/krenko-goblins.json'
import aesiJson from '@/data/sample-decks/aesi-lands.json'
import { getCardByName, getCardCount } from '@/lib/scryfall/sync'
import { getDeck, upsertDeck } from '@/lib/storage/decks'
import type { CardRef } from '@/types/card'
import type { Deck } from '@/types/deck'

export type SampleDeckDef = {
  id: string
  name: string
  commander: string
  notes?: string
  colorIdentity?: string[]
  cards: { name: string; quantity: number }[]
}

export const SAMPLE_DECK_DEFS: SampleDeckDef[] = [
  krenkoJson as SampleDeckDef,
  aesiJson as SampleDeckDef,
]

function stubCard(
  name: string,
  opts: {
    quantity?: number
    isCommander?: boolean
    colorIdentity?: string[]
  } = {},
): CardRef {
  const id = `stub:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const isBasic = /^(Plains|Island|Swamp|Mountain|Forest|Wastes|Snow-Covered )/i.test(
    name,
  )
  return {
    id,
    name,
    quantity: opts.quantity ?? 1,
    isCommander: opts.isCommander,
    colorIdentity: opts.colorIdentity,
    commanderLegality: 'legal',
    typeLine: opts.isCommander
      ? 'Legendary Creature'
      : isBasic
        ? 'Basic Land'
        : undefined,
  }
}

async function resolveCard(
  name: string,
  opts: {
    quantity?: number
    isCommander?: boolean
    colorIdentity?: string[]
  } = {},
): Promise<CardRef> {
  try {
    const synced = await getCardByName(name)
    if (synced) {
      return {
        ...synced,
        quantity: opts.quantity ?? 1,
        isCommander: opts.isCommander ?? synced.isCommander,
      }
    }
  } catch {
    /* DB empty / not ready — fall through to stub */
  }
  return stubCard(name, opts)
}

export async function materializeSampleDeck(def: SampleDeckDef): Promise<Deck> {
  void (await getCardCount())
  const commander = await resolveCard(def.commander, {
    isCommander: true,
    colorIdentity: def.colorIdentity,
  })
  const cards: CardRef[] = []
  for (const entry of def.cards) {
    cards.push(
      await resolveCard(entry.name, {
        quantity: entry.quantity,
        colorIdentity: def.colorIdentity,
      }),
    )
  }
  const now = Date.now()
  return {
    id: def.id,
    name: def.name,
    commander,
    cards,
    notes: def.notes,
    createdAt: now,
    updatedAt: now,
  }
}

/** Insert or refresh bundled starter decks (works without Scryfall sync). */
export async function installSampleDecks(): Promise<Deck[]> {
  const out: Deck[] = []
  for (const def of SAMPLE_DECK_DEFS) {
    const built = await materializeSampleDeck(def)
    const existing = await getDeck(def.id)
    out.push(
      await upsertDeck({
        ...built,
        createdAt: existing?.createdAt ?? built.createdAt,
      }),
    )
  }
  return out
}

export async function listSampleDeckSummaries(): Promise<
  { id: string; name: string; commander: string }[]
> {
  return SAMPLE_DECK_DEFS.map((d) => ({
    id: d.id,
    name: d.name,
    commander: d.commander,
  }))
}
