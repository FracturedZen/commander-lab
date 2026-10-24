import type { CardInstance } from './card'
import type { Phase } from '@/lib/rules/turnMachine'

export type ZoneName =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'

export type { Phase }

export interface PlayerState {
  id: string
  name: string
  life: number
  /** Commander damage taken from each opposing commander id. */
  commanderDamage: Record<string, number>
  zones: Record<ZoneName, CardInstance[]>
  /** Deck id loaded for this seat, if any. */
  deckId?: string
  /**
   * Draws waiting to resolve on the draw step (or queued extra draws).
   * Default each turn: 1. Set to 0 to skip (replacement effects stub).
   */
  pendingDraws: number
  /** True after attempting to draw from an empty library (decked). */
  hasLost: boolean
  loseReason?: 'decked' | 'commander_damage' | 'life' | 'other'
}

export interface TurnState {
  turnNumber: number
  /** Player id whose turn it is. */
  activePlayerId: string
  phase: Phase
  /** Short UX note from last auto action, e.g. "Drew 1". */
  lastAutoNote?: string | null
}

export interface TableState {
  players: PlayerState[]
  turn: TurnState
  /** Object URL or data URL for custom table background (runtime). */
  backgroundUrl: string | null
  /** Seat count 1–4 for hotseat. */
  seatCount: number
  /** False until the user starts a game (deal hands / track turns). */
  gameActive: boolean
  /**
   * Opening mulligan window — true after Start game until Keep / first phase advance.
   * Mid-game free mulligans are not allowed.
   */
  mulliganOpen: boolean
}

/** Persisted table session (background stored separately as blob). */
export interface TableSessionRecord {
  id: string
  name: string
  updatedAt: number
  state: Omit<TableState, 'backgroundUrl'> & {
    hasBackground: boolean
    gameActive?: boolean
    mulliganOpen?: boolean
  }
  log: string[]
}
