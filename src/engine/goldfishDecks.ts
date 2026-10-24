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
