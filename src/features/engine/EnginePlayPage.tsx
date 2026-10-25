import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from 'react-router-dom'
import {
  getPhaseAdapter,
  runHeadlessGoldfish,
  goldfishStubDecksForCount,
  playerCountFromDeckList,
  sanitizePhasePlayer,
  toPhaseMultiDeckList,
  linesFromActionPayload,
  mergeLogLines,
  buildConcedeAction,
  BOOT_STAGE_LABELS,
  type BootProgress,
  type BootStage,
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
const LS_SEATS = 'cl.engine.playerCount'
const LS_AI_SEATS = 'cl.engine.aiDeckIds'
const MAX_TABLE = 4

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


const STAGE_ORDER: BootStage[] = ['glue', 'wasm', 'init', 'card-data', 'load-db', 'ready']

function stageIndex(stage: BootStage): number {
  const i = STAGE_ORDER.indexOf(stage)
  return i < 0 ? -1 : i
}

export function EnginePlayPage() {
  const adapter = useMemo(() => getPhaseAdapter(), [])
  const [status, setStatus] = useState<EngineStatus>(() => {
    const a = getPhaseAdapter()
    return a.status
  })
  const [bootProgress, setBootProgress] = useState<BootProgress | null>(null)
  const [progress, setProgress] = useState('')
  const [decks, setDecks] = useState<Deck[]>([])
  const [decksReady, setDecksReady] = useState(false)
  const [humanDeckId, setHumanDeckId] = useState<string>(() => readLs(LS_HUMAN))
  const [playerCount, setPlayerCount] = useState<number>(() => {
    const n = Number(readLs(LS_SEATS) || '2')
    return Number.isFinite(n) ? Math.max(2, Math.min(MAX_TABLE, Math.floor(n))) : 2
  })
  const [aiDeckIds, setAiDeckIds] = useState<string[]>(() => {
    try {
      const raw = readLs(LS_AI_SEATS)
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          return parsed.length ? parsed : [readLs(LS_AI) || STUB_DECK_ID]
        }
      }
    } catch {
      /* ignore */
    }
    const legacy = readLs(LS_AI)
    return legacy ? [legacy] : [STUB_DECK_ID]
  })
  const [board, setBoard] = useState<PhaseBoardView | null>(null)
  const [clientLog, setClientLog] = useState<string[]>([])
  const [gameLog, setGameLog] = useState<PhaseLogLine[]>([])
  const [logOpen, setLogOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [goldfish, setGoldfish] = useState<GoldfishResult | null>(null)
  const [fallbackBanner, setFallbackBanner] = useState<string | null>(null)
  const [setupOpen, setSetupOpen] = useState(true)
  const [startNote, setStartNote] = useState<string | null>(null)
  const lastDeckList = useRef<PhaseDeckList | null>(null)
  const lastPlayerCount = useRef<number>(2)
  const logEndRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setStatus(adapter.status)
    if (adapter.isReady) {
      setBootProgress({
        stage: 'ready',
        message: `Phase ready (card-data ${adapter.getCardHash() ?? 'cached'})`,
        fraction: 1,
        stageFraction: 1,
        fromCache: true,
      })
    }
  }, [adapter])

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
    setAiDeckIds((prev) => {
      const fallback = list[1]?.id ?? list[0]?.id ?? STUB_DECK_ID
      const next = prev.map((id, i) => {
        if (id === STUB_DECK_ID) return id
        if (id && list.some((d) => d.id === id)) return id
        return list[(i + 1) % Math.max(1, list.length)]?.id ?? fallback
      })
      const needed = Math.max(1, playerCount - 1)
      while (next.length < needed) {
        next.push(list[next.length % Math.max(1, list.length)]?.id ?? fallback)
      }
      writeLs(LS_AI_SEATS, JSON.stringify(next))
      if (next[0]) writeLs(LS_AI, next[0])
      return next
    })
  }, [playerCount])

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
  const pickAiSeat = (seatIndex: number, id: string) => {
    // seatIndex is 0-based among AI seats (Phase seat = seatIndex + 1)
    setAiDeckIds((prev) => {
      const next = [...prev]
      while (next.length <= seatIndex) next.push(STUB_DECK_ID)
      next[seatIndex] = id
      writeLs(LS_AI_SEATS, JSON.stringify(next))
      if (seatIndex === 0) writeLs(LS_AI, id)
      return next
    })
  }
  const changePlayerCount = (n: number) => {
    const bounds = adapter.isReady ? adapter.seatBounds() : { min: 2, max: MAX_TABLE }
    const clamped = Math.max(bounds.min, Math.min(Math.min(bounds.max, MAX_TABLE), n))
    setPlayerCount(clamped)
    writeLs(LS_SEATS, String(clamped))
    setAiDeckIds((prev) => {
      const needed = clamped - 1
      const next = [...prev]
      const fallback = decks[1]?.id ?? decks[0]?.id ?? STUB_DECK_ID
      while (next.length < needed) {
        next.push(decks[next.length % Math.max(1, decks.length)]?.id ?? fallback)
      }
      if (next.length > needed) next.length = needed
      writeLs(LS_AI_SEATS, JSON.stringify(next))
      if (next[0]) writeLs(LS_AI, next[0])
      return next
    })
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

  const resolveDeckOrNull = useCallback(
    (id: string): Deck | null => {
      if (!id || id === STUB_DECK_ID) return null
      return decks.find((d) => d.id === id) ?? null
    },
    [decks],
  )

  const buildDeckList = useCallback((): PhaseDeckList => {
    const n = Math.max(2, Math.min(MAX_TABLE, playerCount))
    const human = resolveDeckOrNull(humanDeckId)
    const aiResolved = aiDeckIds.slice(0, n - 1).map((id) => resolveDeckOrNull(id))

    // All-stub path when human is stub (or missing) — Phase-legal basics for N seats
    if (!human) {
      const stub = goldfishStubDecksForCount(n)
      setStartNote(
        n === 2
          ? 'Using built-in basics stubs (no saved deck selected)'
          : `Using basics stubs · ${n}-player table`,
      )
      return stub
    }

    // Fill missing AI seats by mirroring human (goldfish-style)
    const aiDecks: Deck[] = aiResolved.map((d) => d ?? human)
    while (aiDecks.length < n - 1) aiDecks.push(human)

    let deckList = toPhaseMultiDeckList(human, aiDecks, { playerCount: n })
    const basics = ['Mountain', 'Island', 'Forest', 'Swamp', 'Plains']
    deckList = {
      ...deckList,
      player: sanitizePhasePlayer(deckList.player, 'Mountain'),
      opponent: sanitizePhasePlayer(deckList.opponent, 'Island'),
      ai_decks: deckList.ai_decks.map((d, i) =>
        sanitizePhasePlayer(d, basics[(i + 2) % basics.length]!),
      ),
    }
    const aiNames = aiDecks.map((d, i) => {
      const id = aiDeckIds[i]
      return id === STUB_DECK_ID || !resolveDeckOrNull(id ?? '')
        ? `${d.name} (mirror)`
        : d.name
    })
    setStartNote(`${n}-player · You: ${human.name} · AI: ${aiNames.join(' · ')}`)
    return deckList
  }, [humanDeckId, aiDeckIds, decks, playerCount, resolveDeckOrNull])

  const boot = async () => {
    setBusy(true)
    setFallbackBanner(null)
    setBootProgress({
      stage: 'glue',
      message: 'Starting Phase boot…',
      fraction: 0,
      stageFraction: 0,
    })
    try {
      await adapter.boot((bp) => {
        setBootProgress(bp)
        setProgress(bp.message)
        if (bp.stage === 'error') {
          setStatus({ kind: 'error', message: bp.message })
        } else if (bp.stage === 'ready') {
          setStatus({ kind: 'ready' })
        } else {
          setStatus({ kind: 'loading', detail: bp.message })
        }
      })
      setStatus(adapter.status)
      setBootProgress((prev) =>
        prev?.stage === 'ready'
          ? prev
          : {
              stage: 'ready',
              message: `Phase ready (card-data ${adapter.getCardHash()})`,
              fraction: 1,
              stageFraction: 1,
            },
      )
      pushLog(`Engine ready · card-data ${adapter.getCardHash()}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setStatus({ kind: 'error', message })
      setBootProgress({ stage: 'error', message, fraction: 0 })
      setFallbackBanner(
        `Phase WASM failed to load — Legacy Table still available. (${message})`,
      )
      pushLog(`Boot failed: ${message}`)
    } finally {
      setBusy(false)
    }
  }

  const launchWithDeckList = async (
    deckList: PhaseDeckList,
    label: string,
    seats?: number,
  ) => {
    if (!adapter.isReady) {
      await boot()
      if (!adapter.isReady) return
    }
    const fromList = playerCountFromDeckList(deckList, seats ?? 2)
    // Trust DeckList difficulties; if caller passed seats that match, keep them.
    const n = Math.max(
      2,
      Math.min(MAX_TABLE, seats != null && seats === fromList ? seats : fromList),
    )
    setBusy(true)
    setAiBusy(true)
    try {
      lastDeckList.current = deckList
      lastPlayerCount.current = n
      setGameLog([])
      const initRaw = adapter.startGame(deckList, {
        seed: Date.now() % 1e9,
        playerCount: n,
      })
      ingestResults([initRaw])
      const extras = (deckList.ai_decks ?? [])
        .map((d) => d.commander[0] ?? '?')
        .join(', ')
      pushLog(
        `${label} (${n}p): ${deckList.player.commander[0] ?? '?'} vs ${deckList.opponent.commander[0] ?? '?'}` +
          (extras ? ` + ${extras}` : ''),
      )
      const driven = adapter.driveOpponents({
        maxSteps: 40 + (n - 2) * 30,
      })
      if (driven.results.length) ingestResults(driven.results)
      if (driven.steps)
        pushLog(`Auto-drove opponents ${driven.steps} steps (${driven.stoppedReason})`)
      await syncFromEngine()
      setSetupOpen(false)
      setLogOpen(true)
    } catch (err) {
      pushLog(`Start failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAiBusy(false)
      setBusy(false)
    }
  }

  const startGame = async () => {
    setStartNote(null)
    const deckList = buildDeckList()
    await launchWithDeckList(deckList, 'Game started', playerCount)
  }

  const rematch = async () => {
    const deckList = lastDeckList.current ?? buildDeckList()
    const seats = lastPlayerCount.current || playerCount
    await launchWithDeckList(deckList, 'Rematch', seats)
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
      setAiBusy(true)
      try {
        const n = lastPlayerCount.current || playerCount
        const driven = adapter.driveOpponents({
          maxSteps: 60 + (n - 2) * 40,
        })
        if (driven.results.length) ingestResults(driven.results)
        if (driven.steps) pushLog(`AI drove ${driven.steps} (${driven.stoppedReason})`)
      } finally {
        setAiBusy(false)
      }
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
      setAiBusy(true)
      try {
        const n = lastPlayerCount.current || playerCount
        const driven = adapter.driveOpponents({
          maxSteps: 60 + (n - 2) * 40,
        })
        if (driven.results.length) ingestResults(driven.results)
        if (driven.steps) pushLog(`AI drove ${driven.steps} (${driven.stoppedReason})`)
      } finally {
        setAiBusy(false)
      }
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
    setAiBusy(true)
    try {
      const n = lastPlayerCount.current || playerCount
      const driven = adapter.driveOpponents({
        maxSteps: 40 + (n - 2) * 30,
      })
      if (driven.results.length) ingestResults(driven.results)
      pushLog(`Drive: ${driven.steps} (${driven.stoppedReason})`)
      await syncFromEngine()
    } finally {
      setAiBusy(false)
      setBusy(false)
    }
  }

  const runGoldfish = async () => {
    setBusy(true)
    setAiBusy(true)
    setGoldfish(null)
    try {
      if (!adapter.isReady) await boot()
      // Prefer current IndexedDB picks when human has a saved deck
      const deckList = buildDeckList()
      const result = await runHeadlessGoldfish({
        adapter,
        maxSteps: 800,
        maxTurns: 25,
        onProgress: (m) => setProgress(m),
        decks: deckList,
        playerCount,
      })
      setGoldfish(result)
      pushLog(
        `Goldfish: ${result.stoppedReason} turns=${result.turns} steps=${result.steps} winner=${result.winner}`,
      )
    } finally {
      setAiBusy(false)
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
          <h1 className="text-lg font-semibold text-white">Play · Phase Engine</h1>
          <p className="text-xs text-slate-400">
            Real MTG rules (stack, priority, combat, SBAs). Multi-seat Commander vs Phase AI.
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
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          <span className="min-w-0 flex-1">{fallbackBanner}</span>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void boot()}
              className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
            >
              Retry boot
            </button>
            <Link
              to="/"
              className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-200 ring-1 ring-slate-600 hover:bg-slate-700"
            >
              Legacy Table
            </Link>
          </div>
        </div>
      )}

      {startNote && !setupOpen && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-1.5 text-xs text-emerald-100">
          {startNote}
        </div>
      )}

      {setupOpen && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          {/* Boot progress */}
          <div className="rounded-lg border border-slate-700/80 bg-slate-950/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-200">
                Phase boot
                <span className="ml-2 rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                  {status.kind}
                  {status.kind === 'error' ? ' · failed' : ''}
                </span>
              </p>
              <span className="text-[10px] text-slate-500">
                WASM + card-data cached after first success (SW / IndexedDB). Card-data wire ~7 MB br; Phase parse stays on main.
              </span>
            </div>
            <ol className="mt-2 grid gap-1 sm:grid-cols-3">
              {BOOT_STAGE_LABELS.filter((s) => s.stage !== 'ready').map(({ stage, label }) => {
                const cur = bootProgress?.stage ?? 'glue'
                const curIdx = stageIndex(cur === 'error' ? 'glue' : cur)
                const thisIdx = stageIndex(stage)
                const done =
                  status.kind === 'ready' ||
                  (cur !== 'error' && thisIdx >= 0 && curIdx > thisIdx) ||
                  (bootProgress?.stage === stage && (bootProgress.stageFraction ?? 0) >= 1)
                const active =
                  status.kind === 'loading' && bootProgress?.stage === stage
                return (
                  <li
                    key={stage}
                    className={[
                      'flex items-center gap-1.5 rounded px-2 py-1 text-[11px]',
                      done
                        ? 'bg-emerald-950/40 text-emerald-200'
                        : active
                          ? 'bg-cyan-950/50 text-cyan-100 ring-1 ring-cyan-600/40'
                          : status.kind === 'error' && bootProgress?.stage === 'error'
                            ? 'text-slate-500'
                            : 'text-slate-500',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        done
                          ? 'bg-emerald-400'
                          : active
                            ? 'animate-pulse bg-cyan-400'
                            : 'bg-slate-600',
                      ].join(' ')}
                    />
                    {label}
                  </li>
                )
              })}
            </ol>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={
                  status.kind === 'error'
                    ? 'h-full rounded-full bg-rose-600 transition-all'
                    : status.kind === 'ready'
                      ? 'h-full rounded-full bg-emerald-500 transition-all'
                      : 'h-full rounded-full bg-cyan-500 transition-all'
                }
                style={{
                  width: `${Math.round(
                    Math.max(
                      0,
                      Math.min(
                        1,
                        status.kind === 'ready'
                          ? 1
                          : status.kind === 'error'
                            ? bootProgress?.fraction ?? 0
                            : bootProgress?.fraction ?? 0,
                      ),
                    ) * 100,
                  )}%`,
                }}
              />
            </div>
            <p className="mt-1.5 truncate text-[11px] text-slate-400">
              {bootProgress?.fromCache && status.kind !== 'error' ? (
                <span className="mr-1.5 rounded bg-emerald-950/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-700/60">
                  cached
                </span>
              ) : null}
              {status.kind === 'error'
                ? status.message
                : bootProgress?.message ||
                  (status.kind === 'ready'
                    ? 'Phase ready — Start a table when decks are set'
                    : 'Tap Boot Phase (or Start — boots automatically)')}
              {progress &&
              progress !== bootProgress?.message &&
              status.kind !== 'loading'
                ? ` · ${progress}`
                : ''}
            </p>
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-400">Seats</span>
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                disabled={busy}
                onClick={() => changePlayerCount(n)}
                className={
                  playerCount === n
                    ? 'min-h-10 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white'
                    : 'min-h-10 rounded-md bg-slate-800 px-3 text-sm text-slate-300 ring-1 ring-slate-700 hover:bg-slate-700 disabled:opacity-50'
                }
              >
                {n}p
              </button>
            ))}
            <span className="text-[10px] text-slate-500">
              You = seat 0 · Phase AI on every other seat
            </span>
          </div>

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
            {Array.from({ length: Math.max(1, playerCount - 1) }).map((_, i) => (
              <label key={`ai-${i}`} className="text-xs text-slate-400">
                AI deck (seat {i + 1})
                <select
                  className="mt-1 min-h-11 w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                  value={aiDeckIds[i] || STUB_DECK_ID}
                  onChange={(e) => pickAiSeat(i, e.target.value)}
                >
                  {deckOptions}
                </select>
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || status.kind === 'ready'}
              onClick={() => void boot()}
              className={
                status.kind === 'error'
                  ? 'min-h-11 rounded-md bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-600 disabled:opacity-50'
                  : status.kind === 'ready'
                    ? 'min-h-11 rounded-md bg-emerald-900 px-4 py-2 text-sm font-medium text-emerald-100 ring-1 ring-emerald-700/50 disabled:opacity-80'
                    : 'min-h-11 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-600 disabled:opacity-50'
              }
            >
              {busy && status.kind === 'loading'
                ? 'Booting…'
                : status.kind === 'error'
                  ? 'Retry boot'
                  : status.kind === 'ready'
                    ? 'Phase ready'
                    : 'Boot Phase'}
            </button>
            <button
              type="button"
              disabled={busy || !decksReady}
              onClick={() => void startGame()}
              className="min-h-11 flex-1 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50 sm:flex-none"
            >
              Start {playerCount}p table
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

      {aiBusy && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-500/35 bg-violet-950/40 px-3 py-2 text-xs text-violet-100">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-violet-400" />
          <span className="font-medium">AI thinking…</span>
          <span className="text-violet-200/60">
            Phase driving non-human seats (WaitingFor handled by engine AI)
          </span>
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
          Choose seats + decks, then{' '}
          <strong className="text-slate-300">Start {playerCount}p table</strong>.
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
