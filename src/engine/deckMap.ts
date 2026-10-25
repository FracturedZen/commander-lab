import type { Deck } from '@/types/deck'
import type { CardRef } from '@/types/card'
import type { PhaseDeckList, PhasePlayerDeck } from './types'
import { PHASE_AI_DIFFICULTY } from './config'

function expandNames(cards: CardRef[]): string[] {
  const out: string[] = []
  for (const c of cards) {
    const qty = Math.max(1, c.quantity ?? 1)
    for (let i = 0; i < qty; i++) out.push(c.name)
  }
  return out
}

export function emptyPhasePlayerDeck(): PhasePlayerDeck {
  return {
    main_deck: [],
    sideboard: [],
    commander: [],
    planar_deck: [],
    scheme_deck: [],
    contraption_deck: [],
    sticker_sheets: [],
    signature_spell: [],
    companion: [],
    bracket_tier: 'core',
  }
}

/** Map a Commander Lab deck into Phase's name-only PlayerDeckList. */
export function deckToPhasePlayer(deck: Deck): PhasePlayerDeck {
  const commanders: string[] = []
  if (deck.commander?.name) commanders.push(deck.commander.name)
  if (deck.partner?.name) commanders.push(deck.partner.name)

  const commanderNames = new Set(commanders.map((n) => n.toLowerCase()))
  const main = expandNames(
    deck.cards.filter((c) => !commanderNames.has(c.name.toLowerCase())),
  )

  return {
    ...emptyPhasePlayerDeck(),
    main_deck: main,
    commander: commanders,
    bracket_tier: 'core',
  }
}

/**
 * Build a 2-player DeckList: human seat 0, AI seat 1.
 * When only one deck is provided, mirror it for the AI (goldfish).
 */
export function toPhaseDeckList(
  human: Deck,
  opponent?: Deck | null,
  aiDifficulty: string = PHASE_AI_DIFFICULTY,
): PhaseDeckList {
  const player = deckToPhasePlayer(human)
  const opp = deckToPhasePlayer(opponent ?? human)
  return {
    player,
    opponent: opp,
    ai_decks: [opp],
    ai_difficulties: [aiDifficulty],
  }
}

/** Expand sample deck JSON {name,quantity} lists without IndexedDB. */
export function sampleToPhasePlayer(opts: {
  commander: string
  partner?: string
  cards: { name: string; quantity: number }[]
}): PhasePlayerDeck {
  const commanders = [opts.commander, opts.partner].filter(Boolean) as string[]
  const commanderNames = new Set(commanders.map((n) => n.toLowerCase()))
  const main: string[] = []
  for (const c of opts.cards) {
    if (commanderNames.has(c.name.toLowerCase())) continue
    for (let i = 0; i < Math.max(1, c.quantity); i++) main.push(c.name)
  }
  return {
    ...emptyPhasePlayerDeck(),
    main_deck: main,
    commander: commanders,
    bracket_tier: 'core',
  }
}

/**
 * Build a local multi-seat DeckList for Phase `initialize_game`.
 * Seat 0 = human (`player`), seat 1 = `opponent`, seats 2..N-1 = `ai_decks`
 * (one entry per additional seat — Phase refuses empty libraries).
 * `aiDecks` length must be playerCount-1 (all non-human seats).
 */
export function toPhaseMultiDeckList(
  human: Deck,
  aiDecks: Deck[],
  opts: { playerCount?: number; aiDifficulty?: string } = {},
): PhaseDeckList {
  const playerCount = opts.playerCount ?? aiDecks.length + 1
  const difficulty = opts.aiDifficulty ?? PHASE_AI_DIFFICULTY
  if (aiDecks.length < 1) {
    throw new Error('Need at least one AI deck (2-player minimum)')
  }
  if (aiDecks.length !== playerCount - 1) {
    throw new Error(
      `Expected ${playerCount - 1} AI deck(s) for ${playerCount}-player table, got ${aiDecks.length}`,
    )
  }
  const player = deckToPhasePlayer(human)
  const opponent = deckToPhasePlayer(aiDecks[0])
  const extra = aiDecks.slice(1).map(deckToPhasePlayer)
  return {
    player,
    opponent,
    // Phase: seat1 = opponent; ai_decks[i] = seat i+2. Also keep opponent in
    // ai_difficulties alignment: one difficulty per non-human seat.
    ai_decks: extra,
    ai_difficulties: Array.from({ length: playerCount - 1 }, () => difficulty),
  }
}

