import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  getPhaseAdapter,
  runHeadlessGoldfish,
  goldfishStubDecks,
  sanitizePhasePlayer,
  toPhaseDeckList,
  linesFromActionPayload,
  mergeLogLines,
  buildConcedeAction,
  type EngineStatus,
  type GoldfishResult,
  type PhaseGameAction,
  type PhaseDeckList,
  type PhaseLogLine,
  type PhaseSubmitResult,
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

const STUB_DECK_ID = '__stub_basics__'
const LS_HUMAN = 'cl.engine.humanDeckId'
const LS_AI = 'cl.engine.aiDeckId'

function deckLabel(d: Deck): string {
  const cmd = d.commander?.name
  const n = d.cards.reduce((s, c) => s + Math.max(1, c.quantity ?? 1), 0)
  const total = n + (d.commander ? 1 : 0) + (d.partner ? 1 : 0)
  if (cmd) return `${d.name} · ${cmd} (${total})`
  return `${d.name} (${total})`
}

function readLs(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function writeLs(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* private mode */
  }
}

function appendPhaseResults(
  setGameLog: Dispatch<SetStateAction<PhaseLogLine[]>>,
  payloads: unknown[],
) {
  if (!payloads.length) return
  setGameLog((prev) => {
    let next = prev
    for (const p of payloads) {
      next = mergeLogLines(next, linesFromActionPayload(p))
    }
    return next
  })
}

export function EnginePlayPage() {
  const adapter = useMemo(() => getPhaseAdapter(), [])
  const [status, setStatus] = useState<EngineStatus>({ kind: 'idle' })
  const [progress, setProgress] = useState('')
  const [decks, setDecks] = useState<Deck[]>([])
  const [decksReady, setDecksReady] = useState(false)
  const [humanDeckId, setHumanDeckId] = useState<string>(() => readLs(LS_HUMAN))
  const [aiDeckId, setAiDeckId] = useState<string>(() => readLs(LS_AI))
  const [board, setBoard] = useState<PhaseBoardView | null>(null)
  const [clientLog, setClientLog] = useState<string[]>([])
  const [gameLog, setGameLog] = useState<PhaseLogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [goldfish, setGoldfish] = useState<GoldfishResult | null>(null)
  const [fallbackBanner, setFallbackBanner] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(true)
  const [startNote, setStartNote] = useState<string | null>(null)
  const lastDeckList = useRef<PhaseDeckList | null>(null)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  const refreshDecks = useCallback(async () => {
    await installSampleDecks()
    const list = await listDecks()
    setDecks(list)
    setDecksReady(true)
    setHumanDeckId((prev) => {
      if (prev === STUB_DECK_ID) return prev
      if (prev && list.some((d) => d.id === prev)) return prev
      const next = list[0]?.id ?? STUB_DECK_ID
      writeLs(LS_HUMAN, next)
      return next
    })
    setAiDeckId((prev) => {
      if (prev === STUB_DECK_ID) return prev
      if (prev && list.some((d) => d.id === prev)) return prev
      const next = list[1]?.id ?? list[0]?.id ?? STUB_DECK_ID
      writeLs(LS_AI, next)
      return next
    })
  }, [])

  useEffect(() => {
    void refreshDecks()
  }, [refreshDecks])

  useEffect(() => {
    if (logOpen) logEndRef.current?.scrollIntoView({ block: 'nearest' })
  }, [gameLog, logOpen])

  const pickHuman = (id: string) => {
    setHumanDeckId(id)
    writeLs(LS_HUMAN, id)
  }
  const pickAi = (id: string) => {
    setAiDeckId(id)
    writeLs(LS_AI, id)
  }

  const pushLog = (line: string) =>
    setClientLog((prev) => [`${new Date().toLocaleTimeString()} ${line}`, ...prev].slice(0, 80))

  const ingestResults = useCallback((payloads: unknown[]) => {
    appendPhaseResults(setGameLog, payloads)
  }, [])

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

  const buildDeckList = useCallback((): PhaseDeckList => {
    const human =
      humanDeckId === STUB_DECK_ID
        ? null
        : decks.find((d) => d.id === humanDeckId) ?? null
    const ai =
      aiDeckId === STUB_DECK_ID ? null : decks.find((d) => d.id === aiDeckId) ?? null

    if (human) {
      const oppDeck = ai ?? human
      let deckList = toPhaseDeckList(human, oppDeck)
      deckList = {
        ...deckList,
        player: sanitizePhasePlayer(deckList.player, 'Mountain'),
        opponent: sanitizePhasePlayer(deckList.opponent, 'Island'),
        ai_decks: [sanitizePhasePlayer(deckList.opponent, 'Island')],
      }
      const note = ai
        ? `Saved decks: ${human.name} vs ${ai.name}`
        : `Saved deck ${human.name} (AI mirrors you)`
      setStartNote(note)
      return deckList
    }
    setStartNote('Using built-in basics stubs (no saved deck selected)')
    return goldfishStubDecks()
  }, [humanDeckId, aiDeckId, decks])

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

  const launchWithDeckList = async (deckList: PhaseDeckList, label: string) => {
    if (!adapter.isReady) {
      await boot()
      if (!adapter.isReady) return
    }
    setBusy(true)
    try {
      lastDeckList.current = deckList
      setGameLog([])
      const initRaw = adapter.startGame(deckList, {
        seed: Date.now() % 1e9,
        playerCount: 2,
      })
      ingestResults([initRaw])
      pushLog(
        `${label}: ${deckList.player.commander[0] ?? '?'} vs ${deckList.opponent.commander[0] ?? '?'}`,
      )
      const driven = adapter.driveOpponents({ maxSteps: 40 })
      if (driven.results.length) ingestResults(driven.results)
      if (driven.steps)
        pushLog(`Auto-drove opponents ${driven.steps} steps (${driven.stoppedReason})`)
      await syncFromEngine()
      setSetupOpen(false)
      setLogOpen(true)
    } catch (err) {
      pushLog(`Start failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const startGame = async () => {
    setStartNote(null)
    const deckList = buildDeckList()
    await launchWithDeckList(deckList, 'Game started')
  }

  const rematch = async () => {
    const deckList = lastDeckList.current ?? buildDeckList()
    await launchWithDeckList(deckList, 'Rematch')
  }

  const concede = async () => {
    setBusy(true)
    try {
      try {
        const result: PhaseSubmitResult = adapter.submitAction(buildConcedeAction(0), 0)
        ingestResults([result])
        pushLog('You conceded')
      } catch (err) {
        pushLog(
          `Concede action unavailable — leaving table (${err instanceof Error ? err.message : String(err)})`,
        )
      }
      adapter.clear()
      setBoard(null)
      setSetupOpen(true)
      setStartNote((n) => (n ? `${n} · conceded` : 'Conceded'))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (action: PhaseGameAction) => {
    setBusy(true)
    try {
      const result = adapter.submitAction(action, 0)
      ingestResults([result])
      pushLog(`You: ${summarizeAction(action)}`)
      const driven = adapter.driveOpponents({ maxSteps: 60 })
      if (driven.results.length) ingestResults(driven.results)
      if (driven.steps) pushLog(`AI drove ${driven.steps} (${driven.stoppedReason})`)
      await syncFromEngine()
    } catch (err) {
      pushLog(`Reject: ${err instanceof Error ? err.message : String(err)}`)
      await syncFromEngine()
    } finally {
      setBusy(false)
    }
  }

  const submitChain = async (actions: PhaseGameAction[]) => {
    if (!actions.length) return
    setBusy(true)
    try {
      for (const action of actions) {
        const result = adapter.submitAction(action, 0)
        ingestResults([result])
        pushLog(`You: ${summarizeAction(action)}`)
      }
      const driven = adapter.driveOpponents({ maxSteps: 60 })
      if (driven.results.length) ingestResults(driven.results)
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
      if (driven.results.length) ingestResults(driven.results)
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

  const deckOptions = (
    <>
      {decks.map((d) => (
        <option key={d.id} value={d.id}>
          {deckLabel(d)}
        </option>
      ))}
      <option value={STUB_DECK_ID}>Basics stub (engine test only)</option>
    </>
  )

  const inGame = Boolean(board)

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 px-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-white">Phase Engine</h1>
          <p className="text-xs text-slate-400">
            Saved decks · mana pool · Phase game log · concede / rematch
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {inGame && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void rematch()}
                className="min-h-10 rounded-md bg-emerald-800 px-3 py-2 text-xs font-medium text-emerald-50 ring-1 ring-emerald-600/50 hover:bg-emerald-700 disabled:opacity-50"
              >
                Rematch
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void concede()}
                className="min-h-10 rounded-md bg-rose-950 px-3 py-2 text-xs font-medium text-rose-100 ring-1 ring-rose-700/50 hover:bg-rose-900 disabled:opacity-50"
              >
                Concede
              </button>
            </>
          )}
          <button
            type="button"
            className="min-h-10 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
            onClick={() => setSetupOpen((v) => !v)}
          >
            {setupOpen ? 'Hide setup' : 'Setup'}
          </button>
          <Link
            to="/"
            className="min-h-10 rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
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

      {startNote && !setupOpen && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-100">
          {startNote}
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
            {progress && <span className="truncate text-slate-500">{progress}</span>}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-medium text-slate-200">
              Decks from this device ({decksReady ? decks.length : '…'} saved)
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void refreshDecks()}
                className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-50"
              >
                Refresh
              </button>
              <Link
                to="/decks"
                className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-cyan-200 ring-1 ring-slate-700 hover:bg-slate-700"
              >
                Manage decks
              </Link>
              <Link
                to="/builder"
                className="rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-cyan-200 ring-1 ring-slate-700 hover:bg-slate-700"
              >
                Builder
              </Link>
            </div>
          </div>

          {decksReady && decks.length === 0 && (
            <div className="mt-2 rounded-lg border border-amber-500/30 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
              No saved decks yet. Import or build one, or start with the basics stub.
              Samples install automatically when available.
            </div>
          )}

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-400">
              Your deck (seat 0)
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={humanDeckId || STUB_DECK_ID}
                onChange={(e) => pickHuman(e.target.value)}
              >
                {deckOptions}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              AI deck (seat 1)
              <select
                className="mt-1 min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                value={aiDeckId || STUB_DECK_ID}
                onChange={(e) => pickAi(e.target.value)}
              >
                {deckOptions}
              </select>
            </label>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void boot()}
              className="min-h-11 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50"
            >
              Boot Phase
            </button>
            <button
              type="button"
              disabled={busy || !decksReady}
              onClick={() => void startGame()}
              className="min-h-11 flex-1 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 sm:flex-none"
            >
              Start vs AI
            </button>
            {lastDeckList.current && (
              <button
                type="button"
                disabled={busy || !adapter.isReady}
                onClick={() => void rematch()}
                className="min-h-11 rounded-md bg-emerald-900 px-4 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-700/40 hover:bg-emerald-800 disabled:opacity-50"
              >
                Rematch
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => void runGoldfish()}
              className="min-h-11 rounded-md bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-600 disabled:opacity-50"
            >
              Headless goldfish
            </button>
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
          onConcede={() => void concede()}
          onRematch={() => void rematch()}
        />
      )}

      {!board && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center text-sm text-slate-500">
          Choose decks above, then <strong className="text-slate-300">Start vs AI</strong>.
          Phase boots automatically if needed.
        </div>
      )}

      {/* Phase game log — collapsible, phone-friendly */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/70">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left"
          onClick={() => setLogOpen((v) => !v)}
        >
          <span className="text-xs font-medium text-slate-300">
            Game log
            <span className="ml-2 tabular-nums text-slate-500">{gameLog.length}</span>
          </span>
          <span className="text-[10px] uppercase tracking-wide text-slate-500">
            {logOpen ? 'Hide' : 'Show'}
          </span>
        </button>
        {logOpen && (
          <div className="border-t border-slate-800 px-2 pb-2 pt-1">
            <ul className="max-h-40 space-y-0.5 overflow-y-auto overscroll-contain font-mono text-[11px] text-slate-400 sm:max-h-56">
              {gameLog.length === 0 && (
                <li className="px-1 py-2 text-slate-600">No Phase log entries yet</li>
              )}
              {gameLog.map((line) => (
                <li
                  key={line.id + '-' + line.seq}
                  className={
                    line.importance === 'Essential'
                      ? 'rounded px-1 text-slate-200'
                      : line.importance === 'Context'
                        ? 'rounded px-1 text-slate-300'
                        : 'rounded px-1 text-slate-500'
                  }
                >
                  <span className="mr-1.5 tabular-nums text-slate-600">
                    T{line.turn || '·'}
                  </span>
                  {line.text}
                </li>
              ))}
              <div ref={logEndRef} />
            </ul>
          </div>
        )}
      </div>

      {goldfish && (
        <div className="rounded-lg border border-violet-500/30 bg-violet-950/30 px-3 py-2 text-xs text-violet-100">
          <strong>Goldfish</strong> · {goldfish.stoppedReason} · turns {goldfish.turns} · steps{' '}
          {goldfish.steps} · winner {goldfish.winner ?? 'n/a'}
          {goldfish.error ? ` · err ${goldfish.error}` : ''}
        </div>
      )}

      <details className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-slate-500">
          Client debug log ({clientLog.length})
        </summary>
        <ul className="mt-2 max-h-28 space-y-0.5 overflow-auto font-mono text-[11px] text-slate-600">
          {clientLog.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
