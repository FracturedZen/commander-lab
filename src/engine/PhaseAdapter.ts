import { PHASE_AI_DIFFICULTY } from './config'
import { hasCachedPhaseCardData, loadPhaseCardDataText } from './cardDataCache'
import { loadPhaseWasm } from './loadPhaseWasm'
import { stageOverall, type BootProgressCb } from './bootProgress'
import {
  describeBootCache,
  isPhaseWasmCached,
} from './phaseBootWorker'
import { yieldForPaint, yieldToMain } from './bootYield'
import { assertActionSubmittable } from './assertLegalSubmit'
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


function unwrapPreviewIds(raw: unknown): string[] {
  if (typeof raw === 'string') throw new Error(raw)
  if (!raw || typeof raw !== 'object') return []
  const r = raw as { status?: string; result?: unknown; rejection?: { message?: string } }
  if (r.status === 'rejected') {
    throw new Error(r.rejection?.message || 'Mana preview rejected')
  }
  const result = 'status' in r && 'result' in r ? r.result : raw
  if (!Array.isArray(result)) return []
  return result.map((x) => String(x))
}

function unwrapAction(raw: unknown): PhaseSubmitResult {
  if (typeof raw === 'string') throw new Error(raw)
  if (!raw || typeof raw !== 'object') return { result: raw }
  const r = raw as PhaseSubmitResult & Record<string, unknown>
  if (r.status === 'rejected') {
    throw new Error(r.rejection?.message || 'Action rejected by Phase engine')
  }
  // Flatten ActionResult fields onto the envelope when nested under `result`.
  const nested =
    r.result && typeof r.result === 'object' && !Array.isArray(r.result)
      ? (r.result as Record<string, unknown>)
      : null
  const events =
    (Array.isArray(r.events) && r.events) ||
    (nested && Array.isArray(nested.events) && nested.events) ||
    undefined
  const log_entries =
    (Array.isArray(r.log_entries) && r.log_entries) ||
    (Array.isArray((r as { logEntries?: unknown }).logEntries) &&
      (r as { logEntries?: unknown[] }).logEntries) ||
    (nested && Array.isArray(nested.log_entries) && nested.log_entries) ||
    (nested && Array.isArray(nested.logEntries) && nested.logEntries) ||
    undefined
  return {
    ...r,
    ...(events ? { events } : {}),
    ...(log_entries ? { log_entries } : {}),
  }
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

  async boot(onProgress?: BootProgressCb): Promise<void> {
    try {
      const [wasmCached, cardCached] = await Promise.all([
        isPhaseWasmCached(),
        hasCachedPhaseCardData(),
      ])
      onProgress?.({
        stage: 'glue',
        message: describeBootCache({ wasmCached, cardCached }),
        fraction: stageOverall('glue', 0),
        stageFraction: 0,
        fromCache: wasmCached && cardCached,
      })
      await yieldToMain()

      this.status = { kind: 'loading', detail: 'WASM' }
      this.wasm = await loadPhaseWasm(onProgress)
      this.status = { kind: 'loading', detail: 'card-data' }
      await yieldToMain()
      const { text, hash, fromCache } = await loadPhaseCardDataText(onProgress)

      // load_card_database is one sync WASM call (JSON parse + index in Rust).
      // We cannot split it; paint clear stage text, yield, then accept the hitch.
      onProgress?.({
        stage: 'load-db',
        message: fromCache
          ? 'Preparing Phase load_card_database (cached JSON)…'
          : 'Preparing Phase load_card_database…',
        fraction: stageOverall('load-db', 0.05),
        stageFraction: 0.05,
        fromCache,
      })
      await yieldToMain()
      onProgress?.({
        stage: 'load-db',
        message:
          'Phase parsing card-data on main thread — UI may pause briefly (~95 MB JSON)…',
        fraction: stageOverall('load-db', 0.15),
        stageFraction: 0.15,
        fromCache,
      })
      await yieldForPaint()
      this.wasm.load_card_database(text)
      this.cardHash = hash
      onProgress?.({
        stage: 'load-db',
        message: 'Card database loaded into Phase',
        fraction: stageOverall('load-db', 1),
        stageFraction: 1,
        fromCache,
      })
      await yieldToMain()

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
      onProgress?.({
        stage: 'ready',
        message:
          wasmCached && cardCached
            ? `Phase ready (cached · card-data ${hash})`
            : `Phase ready (card-data ${hash})`,
        fraction: 1,
        stageFraction: 1,
        fromCache: wasmCached && cardCached,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.status = { kind: 'error', message }
      onProgress?.({
        stage: 'error',
        message,
        fraction: 0,
      })
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

  /** Commander (and other) seat range from Phase FormatConfig. */
  seatBounds(): { min: number; max: number } {
    const cfg = this.formatConfig
    if (!cfg) return { min: 2, max: 4 }
    const min = typeof cfg.min_players === 'number' ? cfg.min_players : 2
    const max = typeof cfg.max_players === 'number' ? cfg.max_players : 4
    return { min: Math.max(2, min), max: Math.max(min, max) }
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

  /**
   * Submit a game action. By default enforces the Engine legal gate:
   * action must match current get_legal_actions* (payment_mode-tolerant for
   * cast/activate) or be a WaitingFor response type for the current
   * waiting_for, or Concede. Phase WASM still rejects anything illegal.
   * Pass `{ skipLegalGate: true }` only for trusted Phase AI proposals when
   * the client allowlist is intentionally bypassed (rare).
   */
  submitAction(
    action: PhaseGameAction,
    actor: number = this.viewerId,
    opts: { skipLegalGate?: boolean } = {},
  ): PhaseSubmitResult {
    if (!this.wasm) throw new Error('Phase not booted')
    if (!opts.skipLegalGate) {
      const legal = this.getLegalActions(actor)
      const state = unwrapStateEnvelope(this.getState(actor))
      assertActionSubmittable(action, {
        legal,
        waitingRaw: state.waiting_for,
        allowConcede: true,
      })
    }
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
  } = {}): { steps: number; stoppedReason: string; results: PhaseSubmitResult[] } {
    const humanId = opts.humanId ?? this.viewerId
    const maxSteps = opts.maxSteps ?? 80
    const difficulty = opts.difficulty ?? PHASE_AI_DIFFICULTY
    let steps = 0
    const results: PhaseSubmitResult[] = []

    while (steps < maxSteps) {
      const state = unwrapStateEnvelope(this.getState(humanId))
      if (state.game_over) return { steps, stoppedReason: 'game_over', results }

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
        return { steps, stoppedReason: 'human_to_act', results }
      }

      if (priority === humanId && onlyPass && humanActions.some((a) => a.type === 'PassPriority')) {
        results.push(this.passPriority(humanId))
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
          results.push(
            proposal
              ? this.submitAction(proposal, priority, {
                  // Phase AI proposals are engine-authored; WASM still rejects.
                  skipLegalGate: true,
                })
              : this.passPriority(priority),
          )
        } catch {
          try {
            const la = this.getLegalActions(priority)
            results.push(
              la.actions[0]
                ? this.submitAction(la.actions[0], priority)
                : this.passPriority(priority),
            )
          } catch {
            return { steps, stoppedReason: 'ai_stuck', results }
          }
        }
        steps++
        continue
      }

      // Human auto-pass with empty list — try pass anyway
      try {
        results.push(this.passPriority(humanId))
        steps++
      } catch {
        return { steps, stoppedReason: 'human_to_act', results }
      }
    }
    return { steps, stoppedReason: 'step_limit', results }
  }


  /** Object ids that are legal targets for casting this object (engine helper). */
  legalTargetsForCastable(objectId: number | string): string[] {
    if (!this.wasm?.legal_targets_for_castable_js) return []
    try {
      const n = typeof objectId === 'number' ? objectId : Number(objectId)
      if (!Number.isFinite(n)) return []
      const raw = this.wasm.legal_targets_for_castable_js(n)
      if (Array.isArray(raw)) return raw.map((x) => String(x))
      if (raw && typeof raw === 'object') {
        const r = raw as { result?: unknown; targets?: unknown }
        const list = Array.isArray(r.result) ? r.result : Array.isArray(r.targets) ? r.targets : []
        return list.map((x) => String(x))
      }
      return []
    } catch {
      return []
    }
  }

  /**
   * Preview which permanents Auto payment would tap/activate for a cast.
   * Returns object id strings; empty if preview unavailable.
   */
  previewManaPayment(action: PhaseGameAction, actor: number = this.viewerId): string[] {
    if (!this.wasm?.preview_mana_payment_js) return []
    try {
      return unwrapPreviewIds(this.wasm.preview_mana_payment_js(actor, action))
    } catch {
      return []
    }
  }

  clear(): void {
    this.wasm?.clear_game_state()
  }

  /** Opaque Phase snapshot for IDB mid-game save (single-player). */
  exportGameStateJson(): string {
    if (!this.wasm?.export_game_state_json) {
      throw new Error('Phase export_game_state_json unavailable')
    }
    return this.wasm.export_game_state_json()
  }

  /**
   * Restore a saved SP snapshot then drive stack automation.
   * Forces multiplayer off so restore is accepted.
   */
  restoreAndResume(stateJson: string): unknown {
    if (!this.wasm) throw new Error('Phase not booted')
    if (!this.wasm.restore_game_state) {
      throw new Error('Phase restore_game_state unavailable')
    }
    this.wasm.set_multiplayer_mode?.(false)
    this.wasm.restore_game_state(stateJson)
    if (this.wasm.resume_restored_game_state) {
      return this.wasm.resume_restored_game_state()
    }
    return null
  }
}

let singleton: PhaseAdapter | null = null

export function getPhaseAdapter(): PhaseAdapter {
  if (!singleton) singleton = new PhaseAdapter()
  return singleton
}
