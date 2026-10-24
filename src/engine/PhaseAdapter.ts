import { PHASE_AI_DIFFICULTY } from './config'
import { loadPhaseCardDataText } from './cardDataCache'
import { loadPhaseWasm } from './loadPhaseWasm'
import type {
  EngineStatus,
  PhaseAiProposal,
  PhaseDeckList,
  PhaseFormatConfig,
  PhaseGameAction,
  PhaseLegalActions,
  PhaseMatchConfig,
  PhaseSubmitResult,
  PhaseWasmModule,
} from './types'

function unwrapInit(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const r = raw as {
      status?: string
      error?: boolean | string
      reasons?: string[]
      result?: unknown
    }
    if (r.error === true || r.status === 'error' || r.status === 'rejected' || r.status === 'occupied') {
      const reasons = r.reasons?.join('; ')
      const errMsg = typeof r.error === 'string' ? r.error : undefined
      throw new Error(errMsg || reasons || `initialize_game failed: ${r.status ?? 'error'}`)
    }
    if (r.status && 'result' in r) return r.result
  }
  return raw
}


function unwrapStateEnvelope(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as { state?: Record<string, unknown> }
  if (r.state && typeof r.state === 'object') {
    return { ...r.state, derived: (raw as { derived?: unknown }).derived ?? r.state.derived }
  }
  return raw as Record<string, unknown>
}

function unwrapAction(raw: unknown): PhaseSubmitResult {
  if (typeof raw === 'string') throw new Error(raw)
  if (!raw || typeof raw !== 'object') return { result: raw }
  const r = raw as PhaseSubmitResult
  if (r.status === 'rejected') {
    throw new Error(r.rejection?.message || 'Action rejected by Phase engine')
  }
  return r
}

/**
 * Thin wrapper around Phase engine-wasm JSON API.
 * Rules authority for ENGINE_MODE=phase.
 */
export class PhaseAdapter {
  private wasm: PhaseWasmModule | null = null
  private formatConfig: PhaseFormatConfig | null = null
  private cardHash: string | null = null
  status: EngineStatus = { kind: 'idle' }
  viewerId = 0

  async boot(onProgress?: (msg: string) => void): Promise<void> {
    try {
      this.status = { kind: 'loading', detail: 'WASM' }
      this.wasm = await loadPhaseWasm(onProgress)
      this.status = { kind: 'loading', detail: 'card-data' }
      const { text, hash } = await loadPhaseCardDataText(onProgress)
      onProgress?.('Loading card database into engine…')
      this.wasm.load_card_database(text)
      this.cardHash = hash

      const registry = this.wasm.getFormatRegistry() as Array<{
        format: string
        default_config: PhaseFormatConfig
      }>
      const commander = registry?.find((f) => f.format === 'Commander')
      if (!commander?.default_config) {
        throw new Error('Commander format missing from Phase registry')
      }
      this.formatConfig = commander.default_config
      this.status = { kind: 'ready' }
      onProgress?.(`Phase ready (card-data ${hash})`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.status = { kind: 'error', message }
      throw err
    }
  }

  get isReady(): boolean {
    return this.status.kind === 'ready' && !!this.wasm && !!this.formatConfig
  }

  getFormatConfig(): PhaseFormatConfig {
    if (!this.formatConfig) throw new Error('Phase not booted')
    return this.formatConfig
  }

  getCardHash(): string | null {
    return this.cardHash
  }

  startGame(
    decks: PhaseDeckList,
    opts: {
      seed?: number
      matchConfig?: PhaseMatchConfig
      playerCount?: number
      firstPlayer?: number
    } = {},
  ): unknown {
    if (!this.wasm || !this.formatConfig) throw new Error('Phase not booted')
    this.wasm.clear_game_state()
    const matchConfig: PhaseMatchConfig = opts.matchConfig ?? { match_type: 'Bo1' }
    const raw = this.wasm.initialize_game(
      decks,
      opts.seed ?? Date.now() % 1_000_000_000,
      this.formatConfig,
      matchConfig,
      opts.playerCount ?? 2,
      opts.firstPlayer ?? 0,
    )
    return unwrapInit(raw)
  }

  getState(viewerId: number = this.viewerId): unknown {
    if (!this.wasm) throw new Error('Phase not booted')
    return this.wasm.get_filtered_game_state(viewerId)
  }

  getLegalActions(viewerId: number = this.viewerId): PhaseLegalActions {
    if (!this.wasm) throw new Error('Phase not booted')
    const raw = this.wasm.get_legal_actions_for_viewer_js(viewerId)
    if (!raw || typeof raw !== 'object') return { actions: [] }
    const r = raw as PhaseLegalActions & Record<string, unknown>
    const actions = Array.isArray(r.actions) ? r.actions : []
    const auto =
      r.auto_pass ??
      r.autoPassRecommended ??
      r.auto_pass_recommended
    const byObj =
      r.legalActionsByObject ??
      r.legal_actions_by_object
    return {
      ...r,
      actions,
      auto_pass: Boolean(auto),
      legalActionsByObject: byObj as PhaseLegalActions['legalActionsByObject'],
    }
  }

  submitAction(action: PhaseGameAction, actor: number = this.viewerId): PhaseSubmitResult {
    if (!this.wasm) throw new Error('Phase not booted')
    return unwrapAction(this.wasm.submit_action(actor, action))
  }

  passPriority(actor: number = this.viewerId): PhaseSubmitResult {
    return this.submitAction({ type: 'PassPriority' }, actor)
  }

  proposeAiAction(
    playerId: number,
    difficulty: string = PHASE_AI_DIFFICULTY,
  ): PhaseGameAction | null {
    if (!this.wasm) throw new Error('Phase not booted')
    try {
      const raw = this.wasm.get_ai_action_proposal(difficulty, playerId) as PhaseAiProposal
      if (raw && typeof raw === 'object' && raw.action) return raw.action
      return null
    } catch {
      return null
    }
  }

  /**
   * Drive non-viewer seats with Phase AI (or PassPriority fallback) until
   * it is the viewer's turn again or the game ends / step limit hits.
   */
  driveOpponents(opts: {
    humanId?: number
    maxSteps?: number
    difficulty?: string
  } = {}): { steps: number; stoppedReason: string } {
    const humanId = opts.humanId ?? this.viewerId
    const maxSteps = opts.maxSteps ?? 80
    const difficulty = opts.difficulty ?? PHASE_AI_DIFFICULTY
    let steps = 0

    while (steps < maxSteps) {
      const state = unwrapStateEnvelope(this.getState(humanId))
      if (state.game_over) return { steps, stoppedReason: 'game_over' }

      const legal = this.getLegalActions(humanId)
      // If human has meaningful choices beyond auto-pass, stop.
      const humanActions = legal.actions ?? []
      const autoPass = Boolean(
        legal.auto_pass ??
          (legal as { autoPassRecommended?: boolean }).autoPassRecommended ??
          (legal as { auto_pass_recommended?: boolean }).auto_pass_recommended,
      )
      const onlyPass =
        humanActions.length === 0 ||
        (humanActions.length === 1 && humanActions[0]?.type === 'PassPriority') ||
        autoPass

      const priority =
        (typeof state.priority_player === 'number' ? state.priority_player : undefined) ??
        (typeof state.priority === 'number' ? state.priority : undefined) ??
        (typeof state.active_player === 'number' ? state.active_player : undefined) ??
        0

      if (priority === humanId && !onlyPass && humanActions.length > 0) {
        return { steps, stoppedReason: 'human_to_act' }
      }

      if (priority === humanId && onlyPass && humanActions.some((a) => a.type === 'PassPriority')) {
        this.passPriority(humanId)
        steps++
        continue
      }

      if (priority !== humanId) {
        let proposal = this.proposeAiAction(priority, difficulty)
        if (!proposal) {
          const la = this.getLegalActions(priority)
          proposal =
            la.actions.find(
              (a) =>
                a.type === 'MulliganDecision' &&
                (a.data as { choice?: { type?: string } } | undefined)?.choice?.type ===
                  'Keep',
            ) ??
            la.actions.find((a) => a.type === 'PassPriority') ??
            la.actions[0] ??
            null
        }
        try {
          if (proposal) this.submitAction(proposal, priority)
          else this.passPriority(priority)
        } catch {
          try {
            const la = this.getLegalActions(priority)
            if (la.actions[0]) this.submitAction(la.actions[0], priority)
            else this.passPriority(priority)
          } catch {
            return { steps, stoppedReason: 'ai_stuck' }
          }
        }
        steps++
        continue
      }

      // Human auto-pass with empty list — try pass anyway
      try {
        this.passPriority(humanId)
        steps++
      } catch {
        return { steps, stoppedReason: 'human_to_act' }
      }
    }
    return { steps, stoppedReason: 'step_limit' }
  }

  clear(): void {
    this.wasm?.clear_game_state()
  }
}

let singleton: PhaseAdapter | null = null

export function getPhaseAdapter(): PhaseAdapter {
  if (!singleton) singleton = new PhaseAdapter()
  return singleton
}
