import type { CardInstance } from './card'

export type ZoneName =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'

export interface PlayerState {
  id: string
  name: string
  life: number
  /** Commander damage taken from each opposing commander id. */
  commanderDamage: Record<string, number>
  zones: Record<ZoneName, CardInstance[]>
  /** Deck id loaded for this seat, if any. */
  deckId?: string
}

export interface TurnState {
  turnNumber: number
  /** Player id whose turn it is. */
  activePlayerId: string
  phase: 'untap' | 'upkeep' | 'draw' | 'main1' | 'combat' | 'main2' | 'end'
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
}

/** Persisted table session (background stored separately as blob). */
export interface TableSessionRecord {
  id: string
  name: string
  updatedAt: number
  state: Omit<TableState, 'backgroundUrl'> & { hasBackground: boolean; gameActive?: boolean }
  log: string[]
}
