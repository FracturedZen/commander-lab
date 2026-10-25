import type { PhaseDeckList, PhasePlayerDeck } from './types'
import { emptyPhasePlayerDeck } from './deckMap'
import { PHASE_AI_DIFFICULTY } from './config'

/** Known banned / problematic cards in our sample lists for Phase Commander. */
const STRIP_NAMES = new Set(
  [
    'Dockside Extortionist',
    'Phyrexian Tower', // black land — off-identity in mono-red sample
    'Jeweled Lotus',
    'Mana Crypt',
    'Chaos Orb',
    'Shahrazad',
  ].map((n) => n.toLowerCase()),
)

/**
 * Reliable 100-card Commander stubs for headless / first-boot spike.
 * Basics only — always legal; proves engine + AI without sample-deck bans.
 */
export function goldfishStubDecks(
  aiDifficulty: string = PHASE_AI_DIFFICULTY,
): PhaseDeckList {
  const player = emptyPhasePlayerDeck()
  player.commander = ['Krenko, Mob Boss']
  player.main_deck = Array.from({ length: 99 }, () => 'Mountain')

  const opponent = emptyPhasePlayerDeck()
  opponent.commander = ['Aesi, Tyrant of Gyre Strait']
  opponent.main_deck = [
    ...Array.from({ length: 50 }, () => 'Island'),
    ...Array.from({ length: 49 }, () => 'Forest'),
  ]

  return {
    player,
    opponent,
    ai_decks: [opponent],
    ai_difficulties: [aiDifficulty],
  }
}

/**
 * Best-effort sanitize for Phase Commander: drop known bans / off-sample lands,
 * pad to 99 with a basic matching the first color identity letter if short.
 */
export function sanitizePhasePlayer(
  deck: PhasePlayerDeck,
  basicLand = 'Mountain',
): PhasePlayerDeck {
  const main = deck.main_deck.filter((n) => !STRIP_NAMES.has(n.toLowerCase()))
  while (main.length < 99) main.push(basicLand)
  if (main.length > 99) main.length = 99
  return {
    ...deck,
    main_deck: main,
    commander: deck.commander,
  }
}

const STUB_COMMANDERS = [
  ['Krenko, Mob Boss', 'Mountain'],
  ['Aesi, Tyrant of Gyre Strait', 'Island'],
  ['Selvala, Heart of the Wilds', 'Forest'],
  ['Purphoros, God of the Forge', 'Mountain'],
] as const

/** Basics stubs for local N-seat (2–4) tables — always Commander-legal. */
export function goldfishStubDecksForCount(
  playerCount: number,
  aiDifficulty: string = PHASE_AI_DIFFICULTY,
): PhaseDeckList {
  const n = Math.max(2, Math.min(4, Math.floor(playerCount)))
  const mk = (cmd: string, basic: string): PhasePlayerDeck => {
    const d = emptyPhasePlayerDeck()
    d.commander = [cmd]
    d.main_deck = Array.from({ length: 99 }, () => basic)
    return d
  }
  const seats = STUB_COMMANDERS.slice(0, n).map(([cmd, basic]) => mk(cmd, basic))
  // Aesi uses Island+Forest in 2p stub; keep that flavor for seat 1 when n>=2
  if (n >= 2) {
    seats[1].main_deck = [
      ...Array.from({ length: 50 }, () => 'Island'),
      ...Array.from({ length: 49 }, () => 'Forest'),
    ]
  }
  return {
    player: seats[0],
    opponent: seats[1],
    ai_decks: seats.slice(2),
    ai_difficulties: Array.from({ length: n - 1 }, () => aiDifficulty),
  }
}

