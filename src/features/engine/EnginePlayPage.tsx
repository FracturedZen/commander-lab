import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getPhaseAdapter,
  runHeadlessGoldfish,
  goldfishStubDecks,
  sanitizePhasePlayer,
  toPhaseDeckList,
  type EngineStatus,
  type GoldfishResult,
  type PhaseGameAction,
} from '@/engine'
import {
  buildPhaseBoardView,
  hydrateBoardArt,
  summarizeAction,
  type PhaseBoardView,
} from '@/engine/phaseStateView'
import { listDecks } from '@/lib/storage/decks'
import { installSampleDecks } from '@/lib/sample-decks/install'
import type { Deck } from '@/types/deck'
import { EngineBoard } from './EngineBoard'

export function EnginePlayPage() {
  const adapter = useMemo(() => getPhaseAdapter(), [])
  const [status, setStatus] = useState<EngineStatus>({ kind: 'idle' })
  const [progress, setProgress] = useState('')
  const [decks, setDecks] = useState<Deck[]>([])
  const [humanDeckId, setHumanDeckId] = useState<string>('')
  const [aiDeckId, setAiDeckId] = useState<string>('')
  const [board, setBoard] = useState<PhaseBoardView | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [goldfish, setGoldfish] = useState<GoldfishResult | null>(null)
  const [fallbackBanner, setFallbackBanner] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(true)

  const refreshDecks = useCallback(async () => {
    await installSampleDecks()
    const list = await listDecks()
    setDecks(list)
    if (!humanDeckId && list[0]) setHumanDeckId(list[0].id)
    if (!aiDeckId && list[1]) setAiDeckId(list[1].id)
    else if (!aiDeckId && list[0]) setAiDeckId(list[0].id)
  }, [humanDeckId, aiDeckId])

  useEffect(() => {
    void refreshDecks()
  }, [refreshDecks])

  const pushLog = (line: string) =>
    setLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 80))

  const syncFromEngine = useCallback(async () => {
    try {
      const st = adapter.getState(0)
      const la = adapter.getLegalActions(0)
      let view = buildPhaseBoardView(st, la)
      try {
        view = await hydrateBoardArt(view)
      } catch (err) {
        pushLog(`art hydrate: ${err instanceof Error ? err.message : String(err)}`)
      }
      setBoard(view)
      if (!view.ok) pushLog(view.reason ?? 'board map incomplete')
    } catch (err) {
      pushLog(`sync error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [adapter])

  const boot = async () => {
    setBusy(true)
    setFallbackBanner(null)
    try {
      await adapter.boot((m) => {
        setProgress(m)
        setStatus({ kind: 'loading', detail: m })
      })
      setStatus(adapter.status)
      pushLog(`Engine ready · card-data ${adapter.getCardHash()}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ kind: 'error', message })
      setFallbackBanner(
        `Phase WASM failed to load — legacy table still available. (${message})`,
      )
      pushLog(`Boot failed: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const startGame = async () => {
    if (!adapter.isReady) {
      await boot()
      if (!adapter.isReady) return
    }
    setBusy(true)
    try {
      const human = decks.find((d) => d.id === humanDeckId)
      const ai = decks.find((d) => d.id === aiDeckId)
      let deckList
      if (human) {
        deckList = toPhaseDeckList(human, ai ?? human)
        deckList = {
          ...deckList,
          player: sanitizePhasePlayer(deckList.player, 'Mountain'),
          opponent: sanitizePhasePlayer(deckList.opponent, 'Island'),
          ai_decks: [sanitizePhasePlayer(deckList.opponent, 'Island')],
        }
      } else {
        deckList = goldfishStubDecks()
      }
      adapter.startGame(deckList, { seed: Date.now() % 1e9, playerCount: 2 })
      pushLog(
        `Game started: ${deckList.player.commander[0] ?? '?'} vs ${deckList.opponent.commander[0] ?? '?'}`,
      )
      const driven = adapter.driveOpponents({ maxSteps: 40 })
      if (driven.steps) pushLog(`Auto-drove opponents ${driven.steps} steps (${driven.stoppedReason})`)
      await syncFromEngine()
      setSetupOpen(false)
    } catch (err) {
      pushLog(`Start failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (action: PhaseGameAction) => {
    setBusy(true)
    try {
      adapter.submitAction(action, 0)
      pushLog(`You: ${summarizeAction(action)}`)
      const driven = adapter.driveOpponents({ maxSteps: 60 })
      if (driven.steps) pushLog(`AI drove ${driven.steps} (${driven.stoppedReason})`)
      await syncFromEngine()
    } catch (err) {
      pushLog(`Reject: ${err instanceof Error ? err.message : String(err)}`)
      await syncFromEngine()
    } finally {
      setBusy(false)
    }
  }

  /** Chain mana taps without AI between them (still Phase-legal only). */
  const submitChain = async (actions: PhaseGameAction[]) => {
    if (!actions.length) return
    setBusy(true)
    try {
      for (const action of actions) {
        adapter.submitAction(action, 0)
        pushLog(`You: ${summarizeAction(action)}`)
      }
      const driven = adapter.driveOpponents({ maxSteps: 60 })
      if (driven.steps) pushLog(`AI drove ${driven.steps} (${driven.stoppedReason})`)
      await syncFromEngine()
    } catch (err) {
      pushLog(`Reject: ${err instanceof Error ? err.message : String(err)}`)
      await syncFromEngine()
    } finally {
      setBusy(false)
    }
  }

  const driveAi = async () => {
    setBusy(true)
    try {
      const driven = adapter.driveOpponents({ maxSteps: 40 })
      pushLog(`Drive: ${driven.steps} (${driven.stoppedReason})`)
      await syncFromEngine()
    } finally {
      setBusy(false)
    }
  }

  const runGoldfish = async () => {
    setBusy(true)
    setGoldfish(null)
    try {
      if (!adapter.isReady) await boot()
      const result = await runHeadlessGoldfish({
        adapter,
        maxSteps: 800,
        maxTurns: 25,
        onProgress: (m) => setProgress(m),
      })
      setGoldfish(result)
      pushLog(
        `Goldfish: ${result.stoppedReason} turns=${result.turns} steps=${result.steps} winner=${result.winner}`,
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 px-2 py-3 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-white">Phase Engine</h1>
          <p className="text-xs text-slate-400">
            Arena board ← Phase state. Cyan = legal · rose = targets/discard · orange = combat · amber = mana. Pay: Auto / Manual / Sac-safe.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
            onClick={() => setSetupOpen((v) => !v)}
          >
            {setupOpen ? 'Hide setup' : 'Setup'}
          </button>
          <Link
            to="/"
            className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
          >
            Legacy table
          </Link>
        </div>
      </div>

      {fallbackBanner && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          {fallbackBanner}
        </div>
      )}

      {setupOpen && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
            <span className="rounded bg-slate-800 px-2 py-1 font-mono">
              status: {status.kind}
              {status.kind === 'loading' ? ` · ${status.detail}` : ''}
              {status.kind === 'error' ? ` · ${status.message}` : ''}
            </span>
            {progress && <span className="text-slate-500">{progress}</span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void boot()}
              className="rounded-md bg-cyan-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              Boot Phase
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void startGame()}
              className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              Start vs AI
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void runGoldfish()}
              className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
            >
              Headless goldfish
            </button>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Your deck
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                value={humanDeckId}
                onChange={(e) => setHumanDeckId(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              AI deck
              <select
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-white"
                value={aiDeckId}
                onChange={(e) => setAiDeckId(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {board && (
        <EngineBoard
          view={board}
          busy={busy}
          onSubmit={(a) => void submit(a)}
          onSubmitChain={(acts) => void submitChain(acts)}
          onDriveAi={() => void driveAi()}
          onPreviewMana={(a) => adapter.previewManaPayment(a, 0)}
        />
      )}

      {!board && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
          Boot Phase, then <strong className="text-slate-300">Start vs AI</strong> to load the
          Arena board from engine state.
        </div>
      )}

      {goldfish && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-950/30 px-3 py-2 text-xs text-violet-100">
          <strong>Goldfish</strong> · {goldfish.stoppedReason} · turns {goldfish.turns} · steps{' '}
          {goldfish.steps} · winner {goldfish.winner ?? 'n/a'}
          {goldfish.error ? ` · err ${goldfish.error}` : ''}
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <p className="mb-2 text-xs font-medium text-slate-400">Log</p>
        <ul className="max-h-36 space-y-0.5 overflow-auto font-mono text-[11px] text-slate-500">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
