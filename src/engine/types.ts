/** Minimal Phase wire types used by Commander Lab's adapter. */

export type PhasePlayerDeck = {
  main_deck: string[]
  sideboard: string[]
  commander: string[]
  planar_deck: string[]
  scheme_deck: string[]
  contraption_deck: string[]
  sticker_sheets: string[]
  signature_spell: string[]
  companion?: string[]
  bracket_tier: string
}

export type PhaseDeckList = {
  player: PhasePlayerDeck
  opponent: PhasePlayerDeck
  ai_decks: PhasePlayerDeck[]
  ai_difficulties: string[]
}

export type PhaseFormatConfig = {
  format: string
  starting_life: number
  min_players: number
  max_players: number
  deck_size: unknown
  singleton: boolean
  command_zone: boolean
  commander_damage_threshold: number | null
  range_of_influence: unknown
  team_based: boolean
  sideboard_policy: unknown
  uses_commander: boolean
  default_deck_copy_limit: unknown
  allow_debug_actions: boolean
  [key: string]: unknown
}

export type PhaseMatchConfig = {
  match_type: 'Bo1' | 'Bo3'
  loop_detection?: string
}

export type PhaseGameAction = { type: string; data?: unknown }

export type PhaseLegalActions = {
  actions: PhaseGameAction[]
  auto_pass?: boolean
  autoPassRecommended?: boolean
  /** objectId → ObjectActionPayload[] (flattened GameAction + interactionActionId) */
  legalActionsByObject?: Record<string, unknown[]>
  legal_actions_by_object?: Record<string, unknown[]>
  [key: string]: unknown
}

export type PhaseSubmitResult = {
  status?: string
  events?: unknown[]
  rejection?: { message?: string; [key: string]: unknown }
  result?: unknown
  [key: string]: unknown
}

export type PhaseAiProposal = {
  action?: PhaseGameAction | null
  [key: string]: unknown
}

export type PhaseWasmModule = {
  default: (opts?: { module_or_path?: string | URL | Request }) => Promise<unknown>
  initSync?: (opts: unknown) => unknown
  ping?: () => unknown
  load_card_database: (text: string) => unknown
  initialize_game: (
    decks: unknown,
    seed: number | undefined | null,
    formatConfig: unknown,
    matchConfig: unknown,
    playerCount?: number | null,
    firstPlayer?: number | null,
  ) => unknown
  submit_action: (actor: number, action: unknown) => unknown
  get_game_state: () => unknown
  get_filtered_game_state: (viewerId: number) => unknown
  get_legal_actions_for_viewer_js: (viewerId: number) => unknown
  get_ai_action_proposal: (difficulty: string, playerId: number) => unknown
  clear_game_state: () => void
  getFormatRegistry: () => unknown
  take_last_panic_message?: () => string | null
}

export type EngineStatus =
  | { kind: 'idle' }
  | { kind: 'loading'; detail: string }
  | { kind: 'ready' }
  | { kind: 'error'; message: string }
  | { kind: 'fallback'; message: string }
