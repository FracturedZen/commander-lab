import { PHASE_AI_DIFFICULTY } from './config'
import { goldfishStubDecks } from './goldfishDecks'
import { PhaseAdapter } from './PhaseAdapter'
import type { PhaseDeckList } from './types'

export type GoldfishResult = {
  ok: boolean
  turns: number
  steps: number
  winner: number | null
  stoppedReason: string
  error?: string
  cardHash?: string | null
  log: string[]
}

function sampleDeckList(aiDifficulty: string = PHASE_AI_DIFFICULTY): PhaseDeckList {
  return goldfishStubDecks(aiDifficulty)
}
function readTurn(state: unknown): number {
  if (!state || typeof state !== 'object') return 0
  const s = state as Record<string, unknown>
  const inner = (s.state && typeof s.state === 'object' ? s.state : s) as Record<
    string,
    unknown
  >
  const t = inner.turn ?? inner.turn_number ?? inner.turnNumber
  return typeof t === 'number' ? t : 0
}

function readWinner(state: unknown): number | null {
  if (!state || typeof state !== 'object') return null
  const s = state as Record<string, unknown>
  const inner = (s.state && typeof s.state === 'object' ? s.state : s) as Record<
    string,
    unknown
  >
  if (typeof inner.winner === 'number') return inner.winner
  if (Array.isArray(inner.winners) && typeof inner.winners[0] === 'number') {
    return inner.winners[0]
  }
  const players = inner.players as Array<{ has_lost?: boolean; lost?: boolean }> | undefined
  if (Array.isArray(players)) {
    const alive = players
      .map((p, i) => ({ i, lost: !!(p.has_lost || p.lost) }))
      .filter((p) => !p.lost)
    if (alive.length === 1) return alive[0].i
  }
  return null
}

function isGameOver(state: unknown): boolean {
  if (!state || typeof state !== 'object') return false
  const s = state as Record<string, unknown>
  const inner = (s.state && typeof s.state === 'object' ? s.state : s) as Record<
    string,
    unknown
  >
  return !!(inner.game_over || inner.gameOver || readWinner(state) !== null)
}

/**
 * Headless goldfish: boot Phase, start a local table (stubs or caller decks),
 * drive every seat with Phase AI until game over or limits. Prefer Phase
 * built-in AI (no OpenRouter). Supports 2–4 seats when decks/playerCount set.
 */
export async function runHeadlessGoldfish(opts: {
  maxSteps?: number
  maxTurns?: number
  seed?: number
  difficulty?: string
  onProgress?: (msg: string) => void
  adapter?: PhaseAdapter
  /** When set, use these decks instead of built-in stubs (IndexedDB picks). */
  decks?: PhaseDeckList
  playerCount?: number
} = {}): Promise<GoldfishResult> {
  const log: string[] = []
  const push = (m: string) => {
    log.push(m)
    opts.onProgress?.(m)
  }

  const adapter = opts.adapter ?? new PhaseAdapter()
  try {
    if (!adapter.isReady) {
      await adapter.boot(push)
    }
    const decks = opts.decks ?? sampleDeckList(opts.difficulty ?? PHASE_AI_DIFFICULTY)
    const playerCount = Math.max(
      2,
      opts.playerCount ??
        2 + (Array.isArray(decks.ai_decks) ? decks.ai_decks.length : 0),
    )
    const extras = (decks.ai_decks ?? []).map((d) => d.commander[0] ?? '?').join(', ')
    push(
      `Starting game (${playerCount}p): ${decks.player.commander[0]} vs ${decks.opponent.commander[0]}` +
        (extras ? ` + ${extras}` : ''),
    )
    adapter.startGame(decks, {
      seed: opts.seed ?? 42,
      playerCount,
      firstPlayer: 0,
    })

    const maxSteps = opts.maxSteps ?? 2000
    const maxTurns = opts.maxTurns ?? 50
    let steps = 0
    let lastTurn = 0

    while (steps < maxSteps) {
      const state = adapter.getState(0)
      const turn = readTurn(state)
      if (turn > lastTurn) {
        lastTurn = turn
        push(`Turn ${turn}`)
      }
      if (turn >= maxTurns) {
        return {
          ok: true,
          turns: turn,
          steps,
          winner: readWinner(state),
          stoppedReason: 'turn_limit',
          cardHash: adapter.getCardHash(),
          log,
        }
      }
      if (isGameOver(state)) {
        return {
          ok: true,
          turns: turn,
          steps,
          winner: readWinner(state),
          stoppedReason: 'game_over',
          cardHash: adapter.getCardHash(),
          log,
        }
      }

      // Alternate: ask AI for whoever has priority; fall back to pass.
      const st = (state as { state?: Record<string, unknown> }).state ?? (state as Record<string, unknown>)
      const priority =
        (typeof st.priority_player === 'number'
          ? st.priority_player
          : typeof st.priority === 'number'
            ? st.priority
            : typeof st.active_player === 'number'
              ? st.active_player
              : 0)

      let proposal = adapter.proposeAiAction(
        priority,
        opts.difficulty ?? PHASE_AI_DIFFICULTY,
      )
      if (!proposal) {
        const legal = adapter.getLegalActions(priority)
        const keep = legal.actions.find(
          (a) =>
            a.type === 'MulliganDecision' &&
            (a.data as { choice?: { type?: string } } | undefined)?.choice?.type ===
              'Keep',
        )
        proposal =
          keep ??
          legal.actions.find((a) => a.type === 'PassPriority') ??
          legal.actions[0] ??
          null
      }
      try {
        if (proposal) adapter.submitAction(proposal, priority)
        else adapter.passPriority(priority)
      } catch (err) {
        try {
          const legal = adapter.getLegalActions(priority)
          if (legal.actions[0]) adapter.submitAction(legal.actions[0], priority)
          else adapter.passPriority(priority === 0 ? 1 : 0)
        } catch {
          return {
            ok: false,
            turns: turn,
            steps,
            winner: null,
            stoppedReason: 'stuck',
            error: err instanceof Error ? err.message : String(err),
            cardHash: adapter.getCardHash(),
            log,
          }
        }
      }
      steps++
    }

    const state = adapter.getState(0)
    return {
      ok: true,
      turns: readTurn(state),
      steps,
      winner: readWinner(state),
      stoppedReason: 'step_limit',
      cardHash: adapter.getCardHash(),
      log,
    }
  } catch (err) {
    return {
      ok: false,
      turns: 0,
      steps: 0,
      winner: null,
      stoppedReason: 'error',
      error: err instanceof Error ? err.message : String(err),
      cardHash: adapter.getCardHash(),
      log,
    }
  }
}
