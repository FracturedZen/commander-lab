import type { CardInstance } from './card'
import type { Phase, RailSegmentId } from '@/lib/rules/turnMachine'
import type { PendingAction } from '@/lib/rules/moveLegality'

export type ZoneName =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'

export type { Phase, PendingAction }

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
  /** Lands played this turn (reset on beginTurn). Max 1 under Arena rules. */
  landsPlayedThisTurn: number
  /** Times this seat cast their commander from the command zone (tax = 2×). */
  commanderCastCount: number
}

export interface TurnState {
  turnNumber: number
  /** Player id whose turn it is. */
  activePlayerId: string
  phase: Phase
  /** Short UX note from last auto action, e.g. "Drew 1". */
  lastAutoNote?: string | null
  /**
   * Arena-style phase stops (rail segment ids).
   * Pass advances until the next stop or the next decision point.
   */
  phaseStops?: RailSegmentId[]
  /** True once combat was entered this turn (rail tap or combat stop). */
  combatEntered?: boolean
  /** True if attackers were declared this combat (stub until combat engine). */
  attackersDeclared?: boolean
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
  /**
   * Queued card effects that temporarily allow zone moves (mill, tutor, etc.).
   * Empty under normal play; filled by future card engine or debug grants.
   */
  pendingActions: PendingAction[]
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
    pendingActions?: PendingAction[]
  }
  log: string[]
}
