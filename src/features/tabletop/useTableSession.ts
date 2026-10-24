import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  chooseHeuristicAction,
} from '@/lib/ai/heuristicOpponent'
import { expandDeckCards } from '@/lib/deck/legality'
import { hydrateCardRefs } from '@/lib/scryfall/hydrate'
import {
  DEFAULT_TURN_DRAWS,
  computePassAdvance,
  enterCombatPhase,
  nextPhaseInOrder,
  type Phase,
  type RailSegmentId,
} from '@/lib/rules/turnMachine'
import {
  cardCanActivate,
  checkZoneMove,
  legalDestinations,
  type PendingAction,
  type PendingActionType,
} from '@/lib/rules/moveLegality'
import { shuffle } from '@/lib/shuffle'
import { BLOB_KEYS, deleteBlob, getBlob, putBlob } from '@/lib/storage/blobs'
import { getDeck, listDecks } from '@/lib/storage/decks'
import {
  deleteSession,
  getSession,
  listSessions,
  saveSession,
} from '@/lib/storage/sessions'
import {
  getSetting,
  setSetting,
  SETTINGS_KEYS,
} from '@/lib/storage/settings'
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
    pendingDraws: 0,
    hasLost: false,
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
    pendingDraws: 0,
    hasLost: false,
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

function normalizePlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    pendingDraws: p.pendingDraws ?? 0,
    hasLost: p.hasLost ?? false,
  }
}

function initialTurn(playerId: string, phase: Phase = 'untap'): TurnState {
  return {
    turnNumber: 1,
    activePlayerId: playerId,
    phase,
    lastAutoNote: null,
    phaseStops: [],
    combatEntered: false,
    attackersDeclared: false,
  }
}

function stopsSet(turn: TurnState): Set<RailSegmentId> {
  return new Set(turn.phaseStops ?? [])
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
    },
  }
}

/**
 * Draw up to `count` cards. Empty library while needing a card → decked (lost).
 * Returns updated player + how many were drawn + whether they decked.
 */
function drawCards(
  p: PlayerState,
  count: number,
): { player: PlayerState; drawn: number; decked: boolean } {
  if (count <= 0 || p.hasLost) {
    return { player: p, drawn: 0, decked: false }
  }
  const library = [...p.zones.library]
  const hand = [...p.zones.hand]
  let drawn = 0
  let decked = false
  for (let i = 0; i < count; i++) {
    if (library.length === 0) {
      decked = true
      break
    }
    const top = library.shift()!
    hand.push(top)
    drawn++
  }
  return {
    player: {
      ...p,
      zones: { ...p.zones, library, hand },
      hasLost: decked ? true : p.hasLost,
      loseReason: decked ? 'decked' : p.loseReason,
      pendingDraws: 0,
    },
    drawn,
    decked,
  }
}

function untapPlayer(p: PlayerState): PlayerState {
  return {
    ...p,
    zones: {
      ...p.zones,
      battlefield: p.zones.battlefield.map((c) => ({ ...c, tapped: false })),
    },
  }
}

/**
 * Begin a player's turn at Untap: untap permanents, queue default draws.
 * Commander multiplayer: always queue 1 draw (including first turn).
 */
function beginTurnPlayer(p: PlayerState): PlayerState {
  if (p.hasLost) return p
  return {
    ...untapPlayer(p),
    pendingDraws: DEFAULT_TURN_DRAWS,
  }
}

export function useTableSession() {
  const [seatCount, setSeatCountState] = useState(1)
  const [players, setPlayers] = useState<PlayerState[]>(() => makeEmptySeats(1))
  const [activeSeat, setActiveSeat] = useState(0)
  const [turn, setTurn] = useState<TurnState>(() => initialTurn('p1', 'main1'))
  const [gameActive, setGameActive] = useState(false)
  const [mulliganOpen, setMulliganOpen] = useState(false)
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  const [moveNotice, setMoveNotice] = useState<string | null>(null)
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
  /** When true (default), free Draw is blocked; auto-draw on draw step only. */
  const [rulesStrict, setRulesStrictState] = useState(true)

  const player = players[activeSeat] ?? players[0]!

  useEffect(() => {
    void listDecks().then(setDecks)
    void listSessions().then(setSessions)
    void (async () => {
      const blob = await getBlob(BLOB_KEYS.tableBackground)
      if (blob) setBackgroundUrl(URL.createObjectURL(blob))
      const strict = await getSetting<boolean>(SETTINGS_KEYS.rulesStrict)
      if (strict === false) setRulesStrictState(false)
    })()
  }, [])

  const pushLog = useCallback((msg: string) => {
    setLog((prev) => [msg, ...prev].slice(0, 80))
  }, [])

  const setRulesStrict = useCallback(
    async (value: boolean) => {
      setRulesStrictState(value)
      await setSetting(SETTINGS_KEYS.rulesStrict, value)
      pushLog(
        value
          ? 'Rules: strict — draws only on the draw step (and queued effects).'
          : 'Rules: debug — free Draw enabled for testing.',
      )
    },
    [pushLog],
  )

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
      mulliganOpen,
      pendingActions,
    }),
    [players, turn, backgroundUrl, seatCount, gameActive, mulliganOpen, pendingActions],
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
      setTurn(initialTurn('p1', 'main1'))
      pushLog(`Seats → ${count}`)
    },
    [gameActive, pushLog],
  )

  const adjustLife = useCallback(
    (delta: number, seatIndex = activeSeat) => {
      setPlayers((prev) =>
        prev.map((p, i) => {
          if (i !== seatIndex) return p
          const life = p.life + delta
          const lost = life <= 0
          return {
            ...p,
            life,
            hasLost: lost ? true : p.hasLost,
            loseReason: lost ? 'life' : p.loseReason,
          }
        }),
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
          const next = Math.max(0, current + delta)
          const lost = next >= 21
          return {
            ...p,
            commanderDamage: {
              ...p.commanderDamage,
              [fromSeatId]: next,
            },
            hasLost: lost ? true : p.hasLost,
            loseReason: lost ? 'commander_damage' : p.loseReason,
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

  /**
   * Resolve draws for a seat. Used by draw step + debug free-draw.
   * Does not bypass empty-library loss.
   */
  const resolveDraws = useCallback(
    (seatIndex: number, count: number, reason: string) => {
      let note = ''
      setPlayers((prev) =>
        prev.map((p, i) => {
          if (i !== seatIndex) return p
          if (p.hasLost) {
            note = `${p.name} already lost — no draw.`
            return p
          }
          const { player: next, drawn, decked } = drawCards(p, count)
          if (decked) {
            note = `${p.name} tried to draw from an empty library — decked (lost).`
          } else if (drawn > 0) {
            note = `${reason}: Drew ${drawn}.`
          } else {
            note = `${reason}: no cards drawn (pending was 0).`
          }
          return next
        }),
      )
      if (note) {
        pushLog(note)
        setTurn((t) => ({ ...t, lastAutoNote: note }))
      }
      return note
    },
    [pushLog],
  )

  /** Free Draw — only when rulesStrict is false (debug). */
  const draw = useCallback(
    (n = 1, seatIndex = activeSeat) => {
      if (!gameActive) return
      if (rulesStrict) {
        pushLog(
          'Draw is automatic on the draw step. (Turn off “Strict rules” in Settings for free Draw.)',
        )
        return
      }
      resolveDraws(seatIndex, n, 'Debug draw')
    },
    [activeSeat, gameActive, pushLog, resolveDraws, rulesStrict],
  )

  /** Queue extra draws (card effects stub). Resolved on next draw step if still in earlier phase, or immediately if already past draw. */
  const queueExtraDraws = useCallback(
    (n: number, seatIndex = activeSeat) => {
      if (!gameActive || n <= 0) return
      setPlayers((prev) =>
        prev.map((p, i) =>
          i === seatIndex
            ? { ...p, pendingDraws: Math.max(0, (p.pendingDraws ?? 0) + n) }
            : p,
        ),
      )
      pushLog(`Queued +${n} draw(s) for seat ${seatIndex + 1}.`)
    },
    [activeSeat, gameActive, pushLog],
  )

  const mulligan = useCallback(() => {
    if (!gameActive) return
    if (!mulliganOpen) {
      pushLog('Mulligans only during the opening keep/mulligan window.')
      return
    }
    updateActivePlayer((p) => dealHand(p, 7))
    pushLog(`${player.name} mulliganed — shuffled, drew 7.`)
  }, [gameActive, mulliganOpen, player.name, pushLog, updateActivePlayer])

  const keepHand = useCallback(() => {
    if (!gameActive || !mulliganOpen) return
    setMulliganOpen(false)
    pushLog('Hands kept. Advance phases — draw step auto-draws for the active player.')
  }, [gameActive, mulliganOpen, pushLog])

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

  /** Apply auto actions when entering a phase for the active seat. */
  const enterPhaseEffects = useCallback(
    (phase: Phase, seatIndex: number, playersSnap: PlayerState[]) => {
      if (phase === 'draw') {
        const p = playersSnap[seatIndex]
        const pending = p?.pendingDraws ?? 0
        // Resolve whatever is queued (0 = skip / replacement stub)
        queueMicrotask(() => {
          resolveDraws(
            seatIndex,
            pending,
            pending === 1 ? 'Draw step' : `Draw step (${pending} queued)`,
          )
        })
      }
    },
    [resolveDraws],
  )

  /**
   * Start the next player's turn at Untap (after End), with auto path
   * Untap → Upkeep → Draw (resolve) → Main1 for convenience when ending turn.
   */
  const rotateToNextPlayer = useCallback(
    (fromTurn: TurnState, jumpToMain1: boolean) => {
      const seatIds = players.map((p) => p.id)
      const cur = seatIds.indexOf(fromTurn.activePlayerId)
      const nextIdx = (cur + 1) % Math.max(seatIds.length, 1)
      const nextId = seatIds[nextIdx] ?? 'p1'
      const nextTurnNumber =
        nextIdx === 0 ? fromTurn.turnNumber + 1 : fromTurn.turnNumber

      setActiveSeat(nextIdx)
      setAiLandsPlayed(0)
      setAiMana(0)
      setMulliganOpen(false)

      setPlayers((prev) => {
        const next = prev.map((p, i) =>
          i === nextIdx ? beginTurnPlayer(p) : p,
        )
        queueMicrotask(() => {
          if (jumpToMain1) {
            // Untap already applied; resolve draw step now
            const p = next[nextIdx]
            const pending = p?.pendingDraws ?? DEFAULT_TURN_DRAWS
            resolveDraws(
              nextIdx,
              pending,
              `Turn ${nextTurnNumber} draw step`,
            )
            pushLog(
              `— Turn ${nextTurnNumber}: ${prev[nextIdx]?.name ?? nextId} (untap → draw → main) —`,
            )
          } else {
            pushLog(
              `— Turn ${nextTurnNumber}: ${prev[nextIdx]?.name ?? nextId} — Untap`,
            )
          }
        })
        return next
      })

      return {
        turnNumber: nextTurnNumber,
        activePlayerId: nextId,
        phase: (jumpToMain1 ? 'main1' : 'untap') as Phase,
        lastAutoNote: jumpToMain1 ? 'Drew for turn' : null,
        phaseStops: fromTurn.phaseStops ?? [],
        combatEntered: false,
        attackersDeclared: false,
      } satisfies TurnState
    },
    [players, pushLog, resolveDraws],
  )

  const nextPhase = useCallback(() => {
    if (!gameActive) return
    if (mulliganOpen) setMulliganOpen(false)

    setTurn((t) => {
      const nxt = nextPhaseInOrder(t.phase)
      if (!nxt) {
        // Leaving End → next player, start Untap (user advances manually)
        return rotateToNextPlayer(t, false)
      }

      const seatIdx = players.findIndex((p) => p.id === t.activePlayerId)
      const idx = seatIdx >= 0 ? seatIdx : activeSeat

      if (nxt === 'draw') {
        // Ensure pending draws exist if somehow missed beginTurn
        setPlayers((prev) => {
          const updated = prev.map((p, i) => {
            if (i !== idx) return p
            if ((p.pendingDraws ?? 0) > 0 || p.hasLost) return p
            // Entering draw without a queue: queue default 1 (normal turn)
            return { ...p, pendingDraws: DEFAULT_TURN_DRAWS }
          })
          enterPhaseEffects('draw', idx, updated)
          return updated
        })
      }

      pushLog(`Phase → ${nxt}`)
      return { ...t, phase: nxt, lastAutoNote: nxt === 'draw' ? t.lastAutoNote : null }
    })
  }, [
    activeSeat,
    enterPhaseEffects,
    gameActive,
    mulliganOpen,
    players,
    pushLog,
    rotateToNextPlayer,
  ])

  /** End turn: rotate, untap, auto-draw, land on Main 1. */
  const endTurn = useCallback(() => {
    if (!gameActive) return
    if (mulliganOpen) setMulliganOpen(false)
    setTurn((t) => rotateToNextPlayer(t, true))
  }, [gameActive, mulliganOpen, rotateToNextPlayer])

  /**
   * Arena Pass: auto-walk to the next decision point (skip empty beginning,
   * skip combat when no stop / no attackers, End turn from Main 2).
   */
  const passPriority = useCallback(() => {
    if (!gameActive) return
    if (mulliganOpen) setMulliganOpen(false)

    setTurn((t) => {
      const result = computePassAdvance({
        phase: t.phase,
        stops: stopsSet(t),
        combatEntered: Boolean(t.combatEntered),
        attackersDeclared: Boolean(t.attackersDeclared),
      })

      if (result.kind === 'end_turn') {
        pushLog('Pass — end turn')
        return rotateToNextPlayer(t, true)
      }

      const seatIdx = players.findIndex((p) => p.id === t.activePlayerId)
      const idx = seatIdx >= 0 ? seatIdx : activeSeat
      let phase = result.phase
      let note = result.note ?? null
      let combatEntered = Boolean(t.combatEntered)
      let attackersDeclared = Boolean(t.attackersDeclared)

      // If somehow asked to land in beginning, snap to main1 + resolve draw
      if (phase === 'untap' || phase === 'upkeep' || phase === 'draw') {
        setPlayers((prev) => {
          const updated = prev.map((p, i) => {
            if (i !== idx) return p
            let next = beginTurnPlayer(p)
            return next
          })
          const pending = updated[idx]?.pendingDraws ?? DEFAULT_TURN_DRAWS
          queueMicrotask(() => {
            resolveDraws(idx, pending, 'Draw step')
          })
          return updated
        })
        phase = 'main1'
        note = 'to Main'
      }

      if (phase.startsWith('combat')) {
        combatEntered = true
      }
      if (phase === 'main2' || phase === 'end' || phase === 'main1') {
        // Leaving combat clears attackers stub for next cycle
        if (!phase.startsWith('combat')) {
          attackersDeclared = false
        }
      }

      pushLog(`Pass → ${phase}${note ? ` (${note})` : ''}`)
      return {
        ...t,
        phase,
        lastAutoNote: note,
        combatEntered,
        attackersDeclared,
      }
    })
  }, [
    activeSeat,
    gameActive,
    mulliganOpen,
    players,
    pushLog,
    resolveDraws,
    rotateToNextPlayer,
  ])

  const togglePhaseStop = useCallback((id: RailSegmentId) => {
    setTurn((t) => {
      const cur = new Set(t.phaseStops ?? [])
      if (cur.has(id)) cur.delete(id)
      else cur.add(id)
      const next = Array.from(cur)
      pushLog(
        cur.has(id)
          ? `Phase stop on ${id}`
          : `Phase stop cleared: ${id}`,
      )
      return { ...t, phaseStops: next }
    })
  }, [pushLog])

  /** Enter combat from Main 1 (rail tap). */
  const enterCombat = useCallback(() => {
    if (!gameActive) return
    setTurn((t) => {
      if (t.phase !== 'main1' && t.phase !== 'combat_begin') {
        pushLog('Enter combat from Main 1.')
        return t
      }
      const phase = enterCombatPhase()
      pushLog('Entered combat — declare attackers (Pass skips if none).')
      return {
        ...t,
        phase,
        combatEntered: true,
        attackersDeclared: false,
        lastAutoNote: 'to Combat',
      }
    })
  }, [gameActive, pushLog])

  /** Mark attackers declared (stub — tap creatures into combat later). */
  const declareAttackers = useCallback(() => {
    setTurn((t) => {
      if (!t.phase.startsWith('combat')) return t
      pushLog('Attackers declared.')
      return { ...t, attackersDeclared: true, lastAutoNote: 'Attackers' }
    })
  }, [pushLog])

  const blockMove = useCallback((reason: string) => {
    setMoveNotice(reason)
    pushLog(reason)
    window.setTimeout(() => setMoveNotice((cur) => (cur === reason ? null : cur)), 4000)
  }, [pushLog])

  const consumePendingAction = useCallback((actionId: string | undefined) => {
    if (!actionId) return
    setPendingActions((prev) =>
      prev
        .map((a) =>
          a.id === actionId ? { ...a, count: a.count - 1 } : a,
        )
        .filter((a) => a.count > 0),
    )
  }, [])

  const grantPendingAction = useCallback(
    (type: PendingActionType, count: number, label?: string) => {
      if (!gameActive) return
      if (rulesStrict) {
        blockMove(
          'Granting free effects is debug-only. Turn off Strict rules in Settings.',
        )
        return
      }
      const action: PendingAction = {
        id: crypto.randomUUID(),
        type,
        count,
        playerId: player.id,
        label: label ?? type,
      }
      setPendingActions((prev) => [...prev, action])
      pushLog(`Debug: granted ${type} ×${count}.`)
    },
    [blockMove, gameActive, player.id, pushLog, rulesStrict],
  )

  const getLegalDestinations = useCallback(
    (from: ZoneName, isCommander?: boolean) => {
      return legalDestinations({
        from,
        rulesStrict,
        phase: turn.phase,
        playerId: player.id,
        pendingActions,
        isCommander,
      })
    },
    [pendingActions, player.id, rulesStrict, turn.phase],
  )

  const moveCard = useCallback(
    (
      fromZone: ZoneName,
      toZone: ZoneName,
      instanceId: string,
      seatIndex = activeSeat,
    ) => {
      if (!gameActive) return
      const seat = players[seatIndex]
      if (!seat) return
      const card = seat.zones[fromZone].find((c) => c.instanceId === instanceId)
      if (!card) return

      const check = checkZoneMove({
        from: fromZone,
        to: toZone,
        rulesStrict,
        phase: turn.phase,
        playerId: seat.id,
        pendingActions,
        isCommander: Boolean(card.card.isCommander),
        mulliganOpen,
      })
      if (!check.allowed) {
        blockMove(check.reason ?? 'That move needs a card effect.')
        return
      }

      setPlayers((prev) =>
        prev.map((p, i) => {
          if (i !== seatIndex) return p
          const from = [...p.zones[fromZone]]
          const idx = from.findIndex((c) => c.instanceId === instanceId)
          if (idx < 0) return p
          const [movedCard] = from.splice(idx, 1)
          if (!movedCard) return p
          const moved: CardInstance = {
            ...movedCard,
            tapped: toZone === 'battlefield' ? false : movedCard.tapped,
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
      consumePendingAction(check.consumeActionId)
      setMoveNotice(null)
      pushLog(`Moved ${fromZone} → ${toZone}`)
      setSelectedInstance(null)
    },
    [
      activeSeat,
      blockMove,
      consumePendingAction,
      gameActive,
      mulliganOpen,
      pendingActions,
      players,
      pushLog,
      rulesStrict,
      turn.phase,
    ],
  )

  const moveTopLibraryTo = useCallback(
    (zone: Exclude<ZoneName, 'library'>) => {
      if (!gameActive) return
      const seat = players[activeSeat]
      if (!seat) return
      if (seat.zones.library.length === 0) {
        blockMove('Library empty.')
        return
      }
      const top = seat.zones.library[0]!
      const check = checkZoneMove({
        from: 'library',
        to: zone,
        rulesStrict,
        phase: turn.phase,
        playerId: seat.id,
        pendingActions,
        isCommander: Boolean(top.card.isCommander),
      })
      if (!check.allowed) {
        blockMove(check.reason ?? 'Top-of-library moves need an effect.')
        return
      }
      updateActivePlayer((p) => {
        if (p.zones.library.length === 0) return p
        const [card, ...rest] = p.zones.library
        if (!card) return p
        return {
          ...p,
          zones: {
            ...p.zones,
            library: rest,
            [zone]: [...p.zones[zone], { ...card, tapped: false }],
          },
        }
      })
      consumePendingAction(check.consumeActionId)
      setMoveNotice(null)
      pushLog(`Top library → ${zone}`)
    },
    [
      activeSeat,
      blockMove,
      consumePendingAction,
      gameActive,
      pendingActions,
      players,
      pushLog,
      rulesStrict,
      turn.phase,
      updateActivePlayer,
    ],
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
      const commandersRaw: CardRef[] = []
      if (deck.commander) commandersRaw.push(deck.commander)
      if (deck.partner) commandersRaw.push(deck.partner)
      const libraryRaw = expandDeckCards(deck.cards)
      const hydratedAll = await hydrateCardRefs([
        ...libraryRaw,
        ...commandersRaw,
      ])
      const library = hydratedAll.slice(0, libraryRaw.length)
      const commanders = hydratedAll.slice(libraryRaw.length)
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
   * Start a game: deal 7, commanders in CZ, opening mulligan window.
   * Then run seat 1 through Untap → Draw (Commander draws on turn 1) → Main 1.
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
            seats.push(
              emptyPlayer(`p${i + 1}`, i === 0 ? 'You' : `Seat ${i + 1}`),
            )
            continue
          }
          const deck =
            decks.find((d) => d.id === deckId) ?? (await getDeck(deckId))
          if (!deck) {
            pushLog(`Deck missing for seat ${i + 1}`)
            seats.push(emptyPlayer(`p${i + 1}`, `Seat ${i + 1}`))
            continue
          }
          const commandersRaw: CardRef[] = []
          if (deck.commander) commandersRaw.push(deck.commander)
          if (deck.partner) commandersRaw.push(deck.partner)
          const libraryRaw = expandDeckCards(deck.cards)
          const hydratedAll = await hydrateCardRefs([
            ...libraryRaw,
            ...commandersRaw,
          ])
          const library = hydratedAll.slice(0, libraryRaw.length)
          const commanders = hydratedAll.slice(libraryRaw.length)
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

        // Begin turn 1 for seat 0: untap + queue draw, then resolve draw → main1
        let ready = withCommanderDamageKeys(seats)
        ready = ready.map((p, i) => (i === 0 ? beginTurnPlayer(p) : p))
        const first = ready[0]!
        const { player: afterDraw, drawn, decked } = drawCards(
          first,
          first.pendingDraws,
        )
        ready = ready.map((p, i) => (i === 0 ? afterDraw : p))

        setPlayers(ready)
        setActiveSeat(0)
        setTurn({
          turnNumber: 1,
          activePlayerId: ready[0]!.id,
          phase: 'main1',
          lastAutoNote: decked
            ? 'Decked on turn-1 draw'
            : drawn > 0
              ? `Drew ${drawn}`
              : null,
          phaseStops: [],
          combatEntered: false,
          attackersDeclared: false,
        })
        setGameActive(true)
        setMulliganOpen(true)
        setPendingActions([])
        setMoveNotice(null)
        setAiLandsPlayed(0)
        setAiMana(0)
        setSelectedInstance(null)
        pushLog(
          `Game started · ${count} seat(s) · opening hands dealt · commanders out.`,
        )
        pushLog(
          'Commander multiplayer: you draw on each of your turns, including the first.',
        )
        if (decked) {
          pushLog(`${afterDraw.name} decked on the opening draw — lost.`)
        } else if (drawn > 0) {
          pushLog(`Turn 1 draw step: Drew ${drawn}. (Mulligan window open — Keep or Mulligan.)`)
        }
      } finally {
        setBusy(false)
      }
    },
    [decks, pushLog],
  )

  const endGame = useCallback(() => {
    setGameActive(false)
    setMulliganOpen(false)
    setPendingActions([])
    setMoveNotice(null)
    setPlayers(makeEmptySeats(seatCount))
    setTurn(initialTurn('p1', 'main1'))
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
        mulliganOpen,
        pendingActions,
        hasBackground: Boolean(backgroundUrl),
      },
    }
    await saveSession(record)
    setSessions(await listSessions())
    pushLog('Session saved.')
  }, [
    backgroundUrl,
    gameActive,
    log,
    mulliganOpen,
    pendingActions,
    players,
    pushLog,
    seatCount,
    turn,
  ])

  const restoreSession = useCallback(
    async (id = 'current') => {
      const record = await getSession(id)
      if (!record) {
        pushLog('No saved session.')
        return
      }
      setPlayers(record.state.players.map(normalizePlayer))
      setTurn({
        ...record.state.turn,
        phase: (record.state.turn.phase as Phase) || 'main1',
        phaseStops: record.state.turn.phaseStops ?? [],
        combatEntered: record.state.turn.combatEntered ?? false,
        attackersDeclared: record.state.turn.attackersDeclared ?? false,
      })
      setSeatCountState(record.state.seatCount)
      setGameActive(record.state.gameActive ?? true)
      setMulliganOpen(record.state.mulliganOpen ?? false)
      setPendingActions(record.state.pendingActions ?? [])
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

  const isCardHighlighted = useCallback(
    (
      zone: ZoneName,
      instance: CardInstance,
      seatIndex = activeSeat,
    ) => {
      const seat = players[seatIndex]
      if (!seat || !gameActive) return false
      return cardCanActivate({
        zone,
        rulesStrict,
        phase: turn.phase,
        playerId: seat.id,
        pendingActions,
        isCommander: Boolean(instance.card.isCommander),
        tapped: Boolean(instance.tapped),
        isActivePlayer: seat.id === turn.activePlayerId,
        gameActive,
        mulliganOpen,
      })
    },
    [
      activeSeat,
      gameActive,
      mulliganOpen,
      pendingActions,
      players,
      rulesStrict,
      turn.activePlayerId,
      turn.phase,
    ],
  )

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
    mulliganOpen,
    pendingActions,
    moveNotice,
    busy,
    rulesStrict,
    setRulesStrict,
    grantPendingAction,
    getLegalDestinations,
    isCardHighlighted,
    setActiveSeat,
    setSeatCount,
    setSelectedInstance,
    adjustLife,
    adjustCommanderDamage,
    shuffleLibrary,
    draw,
    mulligan,
    keepHand,
    queueExtraDraws,
    nextPhase,
    passPriority,
    togglePhaseStop,
    enterCombat,
    declareAttackers,
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
