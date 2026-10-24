import type { PhaseDeckList, PhaseGameAction, PhaseLegalActions } from './types'

/**
 * Stand-in when Phase WASM cannot load. Exposes the same surface as PhaseAdapter
 * enough for UI wiring tests — does not implement real MTG rules.
 */
export class MockEngine {
  status = { kind: 'fallback' as const, message: 'Mock engine — Phase WASM unavailable' }
  private step = 0

  async boot(): Promise<void> {
    /* no-op */
  }

  get isReady() {
    return true
  }

  startGame(_decks: PhaseDeckList): unknown {
    this.step = 0
    return { status: 'ok', mock: true }
  }

  getState() {
    return {
      state: {
        turn: 1,
        step: 'Main',
        priority_player: 0,
        players: [{ life: 40 }, { life: 40 }],
        game_over: false,
      },
    }
  }

  getLegalActions(): PhaseLegalActions {
    return {
      actions: [{ type: 'PassPriority' }],
    }
  }

  submitAction(action: PhaseGameAction) {
    this.step++
    return { status: 'ok', action, step: this.step }
  }

  passPriority() {
    return this.submitAction({ type: 'PassPriority' })
  }

  proposeAiAction(): PhaseGameAction | null {
    return { type: 'PassPriority' }
  }

  driveOpponents() {
    return { steps: 0, stoppedReason: 'mock' }
  }

  getCardHash() {
    return 'mock'
  }

  clear() {}
}
