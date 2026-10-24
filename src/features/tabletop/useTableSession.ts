import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  chooseHeuristicAction,
  countBattlefieldLands,
} from '@/lib/ai/heuristicOpponent'
import { expandDeckCards } from '@/lib/deck/legality'
import { shuffle } from '@/lib/shuffle'
import { BLOB_KEYS, deleteBlob, getBlob, putBlob } from '@/lib/storage/blobs'
import { getDeck, listDecks } from '@/lib/storage/decks'
import {
  deleteSession,
  getSession,
  listSessions,
  saveSession,
} from '@/lib/storage/sessions'
import { installSampleDecks } from '@/lib/sample-decks/install'
import type { CardInstance, CardRef } from '@/types/card'
import type { Deck } from '@/types/deck'
import type {
  PlayerState,
  TableSessionRecord,
  TableState,
  TurnState,
  ZoneName,
} from '@/types/game'

const PHASE_ORDER: TurnState['phase'][] = [
  'untap',
  'upkeep',
  'draw',
  'main1',
  'combat',
  'main2',
  'end',
]

function toInstances(cards: CardRef[]): CardInstance[] {
  return cards.map((card) => ({
    instanceId: crypto.randomUUID(),
    card,
    tapped: false,
  }))
}

function emptyZones(): PlayerState['zones'] {
  return {
    library: [],
    hand: [],
    battlefield: [],
    graveyard: [],
    exile: [],
    command: [],
  }
}

function emptyPlayer(id: string, name: string): PlayerState {
  return {
    id,
    name,
    life: 40,
    commanderDamage: {},
    zones: emptyZones(),
  }
}

function buildPlayerFromCards(
  id: string,
  name: string,
  libraryCards: CardRef[],
  commanders: CardRef[],
  deckId?: string,
): PlayerState {
  const shuffled = shuffle(libraryCards)
  return {
    id,
    name,
    life: 40,
    commanderDamage: {},
    deckId,
    zones: {
      ...emptyZones(),
      library: toInstances(shuffled),
      command: toInstances(commanders.map((c) => ({ ...c, isCommander: true }))),
    },
  }
}

function makeEmptySeats(count: number): PlayerState[] {
  const seats: PlayerState[] = []
  for (let i = 1; i <= count; i++) {
    seats.push(emptyPlayer(`p${i}`, i === 1 ? 'You' : `Seat ${i}`))
  }
  return withCommanderDamageKeys(seats)
}

function withCommanderDamageKeys(seats: PlayerState[]): PlayerState[] {
  return seats.map((p) => {
    const cd: Record<string, number> = { ...p.commanderDamage }
    for (const other of seats) {
      if (other.id === p.id) continue
      if (cd[other.id] == null) cd[other.id] = 0
    }
    if (seats.length === 1 && cd['opp-cmd'] == null) cd['opp-cmd'] = 0
    return { ...p, commanderDamage: cd }
  })
}

function initialTurn(playerId: string): TurnState {
  return {
    turnNumber: 1,
    activePlayerId: playerId,
    phase: 'main1',
  }
}

function dealHand(p: PlayerState, n = 7): PlayerState {
  const library = shuffle([...p.zones.library, ...p.zones.hand])
  return {
    ...p,
    zones: {
      ...p.zones,
      hand: library.slice(0, n),
      library: library.slice(n),
      battlefield: [],
      graveyard: [],
      exile: [],
      // keep command zone
    },
  }
}

export function useTableSession() {
  const [seatCount, setSeatCountState] = useState(1)
  const [players, setPlayers] = useState<PlayerState[]>(() => makeEmptySeats(1))
  const [activeSeat, setActiveSeat] = useState(0)
  const [turn, setTurn] = useState<TurnState>(() => initialTurn('p1'))
  const [gameActive, setGameActive] = useState(false)
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([
    'Welcome. Install starter decks or sync cards, then Start a game.',
  ])
  const [decks, setDecks] = useState<Deck[]>([])
  const [sessions, setSessions] = useState<TableSessionRecord[]>([])
  const [selectedInstance, setSelectedInstance] = useState<{
    playerId: string
    zone: ZoneName
    instanceId: string
  } | null>(null)
  const [aiMana, setAiMana] = useState(0)
  const [aiLandsPlayed, setAiLandsPlayed] = useState(0)
  const [busy, setBusy] = useState(false)

  const player = players[activeSeat] ?? players[0]!

  useEffect(() => {
    void listDecks().then(setDecks)
    void listSessions().then(setSessions)
    void (async () => {
      const blob = await getBlob(BLOB_KEYS.tableBackground)
      if (blob) setBackgroundUrl(URL.createObjectURL(blob))
    })()
  }, [])

  const pushLog = useCallback((msg: string) => {
    setLog((prev) => [msg, ...prev].slice(0, 80))
  }, [])

  const refreshDecks = useCallback(() => {
    void listDecks().then(setDecks)
  }, [])

  const updatePlayerAt = useCallback(
    (seatIndex: number, fn: (p: PlayerState) => PlayerState) => {
      setPlayers((prev) => prev.map((p, i) => (i === seatIndex ? fn(p) : p)))
    },
    [],
  )

  const updateActivePlayer = useCallback(
    (fn: (p: PlayerState) => PlayerState) => {
      updatePlayerAt(activeSeat, fn)
    },
    [activeSeat, updatePlayerAt],
  )

  const table: TableState = useMemo(
    () => ({
      players,
      turn,
      backgroundUrl,
      seatCount,
      gameActive,
    }),
    [players, turn, backgroundUrl, seatCount, gameActive],
  )

  const setSeatCount = useCallback(
    (n: number) => {
      if (gameActive) {
        pushLog('End the current game before changing seats.')
        return
      }
      const count = Math.min(4, Math.max(1, n))
      setSeatCountState(count)
      setPlayers(makeEmptySeats(count))
      setActiveSeat(0)
      setTurn(initialTurn('p1'))
      pushLog(`Seats → ${count}`)
    },
    [gameActive, pushLog],
  )

  const adjustLife = useCallback(
    (delta: number, seatIndex = activeSeat) => {
      setPlayers((prev) =>
        prev.map((p, i) =>
          i === seatIndex ? { ...p, life: p.life + delta } : p,
        ),
      )
    },
    [activeSeat],
  )

  const adjustCommanderDamage = useCallback(
    (fromSeatId: string, delta: number, seatIndex = activeSeat) => {
      setPlayers((prev) =>
        prev.map((p, i) => {
          if (i !== seatIndex) return p
          const current = p.commanderDamage[fromSeatId] ?? 0
          return {
            ...p,
            commanderDamage: {
              ...p.commanderDamage,
              [fromSeatId]: Math.max(0, current + delta),
            },
          }
        }),
      )
    },
    [activeSeat],
  )

  const shuffleLibrary = useCallback(() => {
    if (!gameActive) return
    updateActivePlayer((p) => ({
      ...p,
      zones: { ...p.zones, library: shuffle(p.zones.library) },
    }))
    pushLog('Shuffled library.')
  }, [gameActive, pushLog, updateActivePlayer])

  const draw = useCallback(
    (n = 1, seatIndex = activeSeat) => {
      updatePlayerAt(seatIndex, (p) => {
        const library = [...p.zones.library]
        const drawn = library.splice(0, n)
        return {
          ...p,
          zones: {
            ...p.zones,
            library,
            hand: [...p.zones.hand, ...drawn],
          },
        }
      })
      pushLog(`Seat ${seatIndex + 1} drew ${n}.`)
    },
    [activeSeat, pushLog, updatePlayerAt],
  )

  const mulligan = useCallback(() => {
    if (!gameActive) return
    updateActivePlayer((p) => dealHand(p, 7))
    pushLog('Mulligan → shuffled, drew 7.')
  }, [gameActive, pushLog, updateActivePlayer])

  const untapPermanents = useCallback((seatIndex: number) => {
    updatePlayerAt(seatIndex, (p) => ({
      ...p,
      zones: {
        ...p.zones,
        battlefield: p.zones.battlefield.map((c) => ({ ...c, tapped: false })),
      },
    }))
  }, [updatePlayerAt])

  const toggleTap = useCallback(
    (instanceId: string, seatIndex = activeSeat) => {
      updatePlayerAt(seatIndex, (p) => ({
        ...p,
        zones: {
          ...p.zones,
          battlefield: p.zones.battlefield.map((c) =>
            c.instanceId === instanceId ? { ...c, tapped: !c.tapped } : c,
          ),
        },
      }))
    },
    [activeSeat, updatePlayerAt],
  )

  /** Advance one phase; on leaving End, rotate player and auto untap+draw. */
  const nextPhase = useCallback(() => {
    if (!gameActive) return
    setTurn((t) => {
      const idx = PHASE_ORDER.indexOf(t.phase)
      if (idx < 0 || idx === PHASE_ORDER.length - 1) {
        // End turn → next player
        const seatIds = players.map((p) => p.id)
        const cur = seatIds.indexOf(t.activePlayerId)
        const nextIdx = (cur + 1) % Math.max(seatIds.length, 1)
        const nextId = seatIds[nextIdx] ?? 'p1'
        const nextTurnNumber = nextIdx === 0 ? t.turnNumber + 1 : t.turnNumber

        setActiveSeat(nextIdx)
        setAiLandsPlayed(0)
        setAiMana(0)

        // Untap + draw for the new active player (skip draw on very first turn seat 0 if needed — EDH often draws on turn 1)
        queueMicrotask(() => {
          untapPermanents(nextIdx)
          draw(1, nextIdx)
          pushLog(
            `— Turn ${nextTurnNumber}: ${players[nextIdx]?.name ?? nextId} (untap → draw) —`,
          )
        })

        return {
          turnNumber: nextTurnNumber,
          activePlayerId: nextId,
          phase: 'main1',
        }
      }

      const phase = PHASE_ORDER[idx + 1]!
      if (phase === 'draw') {
        queueMicrotask(() => draw(1, activeSeat))
      }
      if (phase === 'untap') {
        queueMicrotask(() => {
          untapPermanents(activeSeat)
          setAiLandsPlayed(0)
          setAiMana(countBattlefieldLands(player))
        })
      }
      pushLog(`Phase → ${phase}`)
      return { ...t, phase }
    })
  }, [
    activeSeat,
    draw,
    gameActive,
    player,
    players,
    pushLog,
    untapPermanents,
  ])

  const endTurn = useCallback(() => {
    if (!gameActive) return
    // Jump to end-of-turn rotation
    setTurn((t) => {
      const seatIds = players.map((p) => p.id)
      const cur = seatIds.indexOf(t.activePlayerId)
      const nextIdx = (cur + 1) % Math.max(seatIds.length, 1)
      const nextId = seatIds[nextIdx] ?? 'p1'
      const nextTurnNumber = nextIdx === 0 ? t.turnNumber + 1 : t.turnNumber
      setActiveSeat(nextIdx)
      setAiLandsPlayed(0)
      setAiMana(0)
      queueMicrotask(() => {
        untapPermanents(nextIdx)
        draw(1, nextIdx)
        pushLog(
          `End turn → ${players[nextIdx]?.name ?? nextId} (T${nextTurnNumber})`,
        )
      })
      return {
        turnNumber: nextTurnNumber,
        activePlayerId: nextId,
        phase: 'main1',
      }
    })
  }, [draw, gameActive, players, pushLog, untapPermanents])

  const moveCard = useCallback(
    (
      fromZone: ZoneName,
      toZone: ZoneName,
      instanceId: string,
      seatIndex = activeSeat,
    ) => {
      if (!gameActive) return
      setPlayers((prev) =>
        prev.map((p, i) => {
          if (i !== seatIndex) return p
          const from = [...p.zones[fromZone]]
          const idx = from.findIndex((c) => c.instanceId === instanceId)
          if (idx < 0) return p
          const [card] = from.splice(idx, 1)
          if (!card) return p
          const moved: CardInstance = {
            ...card,
            tapped: toZone === 'battlefield' ? false : card.tapped,
          }
          return {
            ...p,
            zones: {
              ...p.zones,
              [fromZone]: from,
              [toZone]: [...p.zones[toZone], moved],
            },
          }
        }),
      )
      pushLog(`Moved → ${toZone}`)
      setSelectedInstance(null)
    },
    [activeSeat, gameActive, pushLog],
  )

  const moveTopLibraryTo = useCallback(
    (zone: Exclude<ZoneName, 'library'>) => {
      if (!gameActive) return
      updateActivePlayer((p) => {
        if (p.zones.library.length === 0) return p
        const [top, ...rest] = p.zones.library
        if (!top) return p
        return {
          ...p,
          zones: {
            ...p.zones,
            library: rest,
            [zone]: [...p.zones[zone], { ...top, tapped: false }],
          },
        }
      })
      pushLog(`Top library → ${zone}`)
    },
    [gameActive, pushLog, updateActivePlayer],
  )

  const setBackground = useCallback(
    async (fileOrUrl: File | string | null) => {
      setBackgroundUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
        return null
      })
      if (!fileOrUrl) {
        await deleteBlob(BLOB_KEYS.tableBackground)
        pushLog('Background cleared.')
        return
      }
      if (typeof fileOrUrl === 'string') {
        setBackgroundUrl(fileOrUrl)
        pushLog('Custom background applied.')
        return
      }
      await putBlob(BLOB_KEYS.tableBackground, fileOrUrl)
      setBackgroundUrl(URL.createObjectURL(fileOrUrl))
      pushLog('Background saved.')
    },
    [pushLog],
  )

  const loadDeckOntoSeat = useCallback(
    async (deckId: string, seatIndex: number) => {
      const deck =
        decks.find((d) => d.id === deckId) ?? (await getDeck(deckId))
      if (!deck) {
        pushLog('Deck not found.')
        return false
      }
      const commanders: CardRef[] = []
      if (deck.commander) commanders.push(deck.commander)
      if (deck.partner) commanders.push(deck.partner)
      const library = expandDeckCards(deck.cards)
      const next = buildPlayerFromCards(
        `p${seatIndex + 1}`,
        seatIndex === 0 ? 'You' : `Seat ${seatIndex + 1}`,
        library,
        commanders.length
          ? commanders
          : [{ id: 'no-cmd', name: 'No Commander', isCommander: true }],
        deck.id,
      )
      setPlayers((prev) => {
        const seats =
          prev.length >= seatIndex + 1
            ? prev.map((p, i) => (i === seatIndex ? next : p))
            : makeEmptySeats(Math.max(seatCount, seatIndex + 1)).map((p, i) =>
                i === seatIndex ? next : prev[i] ?? p,
              )
        return withCommanderDamageKeys(seats)
      })
      pushLog(`Loaded “${deck.name}” on seat ${seatIndex + 1}.`)
      return true
    },
    [decks, pushLog, seatCount],
  )

  /**
   * Start a game: require a deck per seat (seat 0 at minimum), deal 7, commanders in CZ.
   */
  const startGame = useCallback(
    async (opts: {
      seatCount: number
      deckIds: (string | null)[]
    }) => {
      setBusy(true)
      try {
        const count = Math.min(4, Math.max(1, opts.seatCount))
        const primaryDeckId = opts.deckIds[0]
        if (!primaryDeckId) {
          pushLog('Pick a deck for Seat 1 to start.')
          return
        }

        setSeatCountState(count)
        const seats: PlayerState[] = []
        for (let i = 0; i < count; i++) {
          const deckId = opts.deckIds[i] ?? (i === 0 ? primaryDeckId : null)
          if (!deckId) {
            seats.push(emptyPlayer(`p${i + 1}`, i === 0 ? 'You' : `Seat ${i + 1}`))
            continue
          }
          const deck =
            decks.find((d) => d.id === deckId) ?? (await getDeck(deckId))
          if (!deck) {
            pushLog(`Deck missing for seat ${i + 1}`)
            seats.push(emptyPlayer(`p${i + 1}`, `Seat ${i + 1}`))
            continue
          }
          const commanders: CardRef[] = []
          if (deck.commander) commanders.push(deck.commander)
          if (deck.partner) commanders.push(deck.partner)
          const library = expandDeckCards(deck.cards)
          let p = buildPlayerFromCards(
            `p${i + 1}`,
            i === 0 ? 'You' : `Seat ${i + 1}`,
            library,
            commanders.length
              ? commanders
              : [{ id: 'no-cmd', name: 'No Commander', isCommander: true }],
            deck.id,
          )
          p = dealHand(p, 7)
          seats.push(p)
        }

        const ready = withCommanderDamageKeys(seats)
        setPlayers(ready)
        setActiveSeat(0)
        setTurn(initialTurn(ready[0]!.id))
        setGameActive(true)
        setAiLandsPlayed(0)
        setAiMana(0)
        setSelectedInstance(null)
        pushLog(
          `Game started · ${count} seat(s) · opening hands dealt · commanders in command zone.`,
        )
      } finally {
        setBusy(false)
      }
    },
    [decks, pushLog],
  )

  const endGame = useCallback(() => {
    setGameActive(false)
    setPlayers(makeEmptySeats(seatCount))
    setTurn(initialTurn('p1'))
    setActiveSeat(0)
    setSelectedInstance(null)
    pushLog('Game ended. Start again when ready.')
  }, [pushLog, seatCount])

  const resetSession = useCallback(() => {
    endGame()
  }, [endGame])

  const persistSession = useCallback(async () => {
    const record: TableSessionRecord = {
      id: 'current',
      name: 'Current table',
      updatedAt: Date.now(),
      log,
      state: {
        players,
        turn,
        seatCount,
        gameActive,
        hasBackground: Boolean(backgroundUrl),
      },
    }
    await saveSession(record)
    setSessions(await listSessions())
    pushLog('Session saved.')
  }, [backgroundUrl, gameActive, log, players, pushLog, seatCount, turn])

  const restoreSession = useCallback(
    async (id = 'current') => {
      const record = await getSession(id)
      if (!record) {
        pushLog('No saved session.')
        return
      }
      setPlayers(record.state.players)
      setTurn(record.state.turn)
      setSeatCountState(record.state.seatCount)
      setGameActive(record.state.gameActive ?? true)
      setLog(record.log)
      setActiveSeat(
        Math.max(
          0,
          record.state.players.findIndex(
            (p) => p.id === record.state.turn.activePlayerId,
          ),
        ),
      )
      pushLog('Session restored.')
    },
    [pushLog],
  )

  const clearSavedSession = useCallback(async () => {
    await deleteSession('current')
    setSessions(await listSessions())
    pushLog('Saved session deleted.')
  }, [pushLog])

  const installStarters = useCallback(async () => {
    setBusy(true)
    try {
      await installSampleDecks()
      const next = await listDecks()
      setDecks(next)
      pushLog('Installed starter decks: Krenko Goblins + Aesi Lands.')
      return next
    } catch (e) {
      pushLog(
        `Starter install failed: ${e instanceof Error ? e.message : String(e)}`,
      )
      return []
    } finally {
      setBusy(false)
    }
  }, [pushLog])

  const runAiOpponentStep = useCallback(() => {
    if (!gameActive) return
    const action = chooseHeuristicAction(player, {
      availableMana: aiMana,
      landsPlayedThisTurn: aiLandsPlayed,
    })
    if (action.type === 'play_land') {
      moveCard('hand', 'battlefield', action.instanceId)
      setAiLandsPlayed((n) => n + 1)
      setAiMana((m) => m + 1)
      pushLog(`AI: land ${action.name}`)
      return
    }
    if (action.type === 'cast') {
      moveCard('hand', 'battlefield', action.instanceId)
      setAiMana((m) => Math.max(0, m - action.cmc))
      pushLog(`AI: cast ${action.name}`)
      return
    }
    pushLog(`AI: pass — ${action.reason}`)
  }, [aiLandsPlayed, aiMana, gameActive, moveCard, player, pushLog])

  return {
    table,
    player,
    players,
    turn,
    log,
    decks,
    sessions,
    seatCount,
    activeSeat,
    selectedInstance,
    gameActive,
    busy,
    setActiveSeat,
    setSeatCount,
    setSelectedInstance,
    adjustLife,
    adjustCommanderDamage,
    shuffleLibrary,
    draw,
    mulligan,
    nextPhase,
    endTurn,
    moveTopLibraryTo,
    moveCard,
    toggleTap,
    setBackground,
    resetSession,
    endGame,
    startGame,
    loadDeckOntoSeat,
    persistSession,
    restoreSession,
    clearSavedSession,
    runAiOpponentStep,
    installStarters,
    refreshDecks,
  }
}
