import { useEffect, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CardChip } from '@/components/CardChip'
import { CardDetailOverlay } from '@/components/CardDetailOverlay'
import { PhaseRail } from '@/components/PhaseRail'
import { StackStub } from '@/components/StackStub'
import { isLand } from '@/types/card'
import { BackgroundControl } from './BackgroundControl'
import { useTableSession } from './useTableSession'
import { SAMPLE_DECK_DEFS } from '@/lib/sample-decks/install'
import type { CardInstance, CardRef } from '@/types/card'
import type { RailSegmentId } from '@/lib/rules/turnMachine'
import type { ZoneName } from '@/types/game'

type LandStack = {
  key: string
  name: string
  cards: CardInstance[]
  untapped: number
  tapped: number
}

function stackLands(cards: CardInstance[]): LandStack[] {
  const map = new Map<string, LandStack>()
  for (const c of cards) {
    const key = c.card.oracleId ?? c.card.name
    let stack = map.get(key)
    if (!stack) {
      stack = {
        key,
        name: c.card.name,
        cards: [],
        untapped: 0,
        tapped: 0,
      }
      map.set(key, stack)
    }
    stack.cards.push(c)
    if (c.tapped) stack.tapped++
    else stack.untapped++
  }
  return Array.from(map.values())
}

export function TabletopPage() {
  const s = useTableSession()
  const {
    player,
    players,
    turn,
    log,
    table,
    decks,
    seatCount,
    activeSeat,
    selectedInstance,
    gameActive,
    mulliganOpen,
    pendingActions,
    moveNotice,
    busy,
    rulesStrict,
    grantPendingAction,
    getLegalDestinations,
    canDropZone,
    isCardHighlighted,
    adjustLife,
    adjustCommanderDamage,
    shuffleLibrary,
    draw,
    mulligan,
    keepHand,
    nextPhase,
    passPriority,
    togglePhaseStop,
    enterCombat,
    endTurn,
    moveTopLibraryTo,
    moveCard,
    toggleTap,
    setBackground,
    endGame,
    startGame,
    persistSession,
    restoreSession,
    setActiveSeat,
    setSeatCount,
    setSelectedInstance,
    runAiOpponentStep,
    installStarters,
    refreshDecks,
  } = s

  const [dragOverZone, setDragOverZone] = useState<ZoneName | null>(null)
  const [setupSeats, setSetupSeats] = useState(1)
  const [setupDecks, setSetupDecks] = useState<(string | null)[]>([null])
  const [menuOpen, setMenuOpen] = useState(false)
  const [inspect, setInspect] = useState<{
    card: CardRef
    zone: ZoneName
    instanceId: string
  } | null>(null)

  useEffect(() => {
    setSetupDecks((prev) => {
      const next = Array.from({ length: setupSeats }, (_, i) => prev[i] ?? null)
      return next
    })
  }, [setupSeats])

  const stops = useMemo(
    () => new Set<RailSegmentId>(turn.phaseStops ?? []),
    [turn.phaseStops],
  )

  const { creatures, lands, landStacks } = useMemo(() => {
    const bf = player.zones.battlefield
    const landCards = bf.filter((c) => isLand(c.card))
    const nonLand = bf.filter((c) => !isLand(c.card))
    return {
      creatures: nonLand,
      lands: landCards,
      landStacks: stackLands(landCards),
    }
  }, [player.zones.battlefield])

  function selectedCardRef(): CardRef | undefined {
    if (!selectedInstance) return undefined
    return player.zones[selectedInstance.zone].find(
      (c) => c.instanceId === selectedInstance.instanceId,
    )?.card
  }

  function onDropTo(zone: ZoneName) {
    setDragOverZone(null)
    if (!selectedInstance || !gameActive) return
    if (selectedInstance.zone === zone) return
    const card = selectedCardRef()
    if (
      !canDropZone(
        selectedInstance.zone,
        zone,
        card,
        Boolean(card?.isCommander),
      )
    ) {
      return
    }
    moveCard(selectedInstance.zone, zone, selectedInstance.instanceId)
  }

  function zoneHandlers(zone: ZoneName) {
    const card = selectedCardRef()
    const legal =
      Boolean(selectedInstance) &&
      gameActive &&
      selectedInstance!.zone !== zone &&
      canDropZone(
        selectedInstance!.zone,
        zone,
        card,
        Boolean(card?.isCommander),
      )
    return {
      onDragOver: (e: DragEvent) => {
        if (!legal) {
          setDragOverZone(null)
          return
        }
        e.preventDefault()
        setDragOverZone(zone)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        if (!legal) return
        onDropTo(zone)
      },
      dropActive: legal && dragOverZone === zone,
    }
  }

  async function onInstallStarters() {
    const next = await installStarters()
    if (next.length && !setupDecks[0]) {
      const sample = next.find((d) => d.id.startsWith('sample-'))
      if (sample) {
        setSetupDecks((prev) => {
          const copy = [...prev]
          copy[0] = sample.id
          return copy
        })
      }
    }
  }

  function openInspect(zone: ZoneName, c: CardInstance) {
    setInspect({ card: c.card, zone, instanceId: c.instanceId })
  }

  function selectForMove(zone: ZoneName, c: CardInstance) {
    setSelectedInstance({
      playerId: player.id,
      zone,
      instanceId: c.instanceId,
    })
  }

  const activeName =
    players.find((p) => p.id === turn.activePlayerId)?.name ?? 'Player'
  const yourTurn = player.id === turn.activePlayerId
  const opponents = players.filter((_, i) => i !== activeSeat)

  return (
    <div className="relative mx-auto flex max-w-6xl flex-col gap-2 px-2 pb-28 pt-2 sm:px-4">
      {!gameActive && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/30 px-4 py-3">
          <p className="text-sm font-medium text-amber-100">
            No game started yet
          </p>
          <p className="mt-1 text-xs text-amber-200/70">
            Start a game below to deal opening hands, put commanders in the
            command zone, and track turns. Drawing happens on the draw step.
          </p>
        </div>
      )}

      {!gameActive && (
        <div className="rounded-2xl border border-emerald-700/40 bg-gradient-to-br from-emerald-950/80 to-slate-950 p-4 shadow-lg">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold text-white">Start game</h1>
              <p className="text-sm text-slate-400">
                Pick seats + decks. Starter decks work without Scryfall sync.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onInstallStarters()}
                className="rounded-md bg-indigo-600 px-3 py-2 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Install starter decks
              </button>
              <button
                type="button"
                onClick={() => void restoreSession()}
                className="rounded-md bg-slate-800 px-3 py-2 text-xs text-slate-200 ring-1 ring-slate-600"
              >
                Restore session
              </button>
              <BackgroundControl
                backgroundUrl={table.backgroundUrl}
                onChange={(v) => void setBackground(v)}
              />
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            Seats
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => {
                  setSetupSeats(n)
                  setSeatCount(n)
                }}
                className={[
                  'min-h-9 min-w-9 rounded-md font-semibold',
                  setupSeats === n
                    ? 'bg-emerald-600 text-white'
                    : 'bg-slate-800 text-slate-300',
                ].join(' ')}
              >
                {n}
              </button>
            ))}
            <Link
              to="/decks"
              className="ml-auto text-emerald-300 underline"
              onClick={() => refreshDecks()}
            >
              Manage decks
            </Link>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: setupSeats }, (_, i) => (
              <label
                key={i}
                className="flex flex-col gap-1 rounded-lg border border-slate-700/80 bg-black/30 p-2 text-[11px] text-slate-400"
              >
                Seat {i + 1}
                {i === 0 ? ' (you)' : ''} deck
                <select
                  value={setupDecks[i] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value || null
                    setSetupDecks((prev) => {
                      const copy = [...prev]
                      copy[i] = v
                      return copy
                    })
                  }}
                  className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white"
                >
                  <option value="">Select deck…</option>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.commander ? ` — ${d.commander.name}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {decks.length === 0 && (
            <p className="mt-3 text-xs text-amber-200/90">
              No decks yet. Tap <strong>Install starter decks</strong> (
              {SAMPLE_DECK_DEFS.map((d) => d.commander).join(' · ')}) or open the{' '}
              <Link to="/builder" className="underline">
                builder
              </Link>
              .
            </p>
          )}

          <button
            type="button"
            disabled={busy || !setupDecks[0]}
            onClick={() =>
              void startGame({ seatCount: setupSeats, deckIds: setupDecks })
            }
            className="mt-4 w-full rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white shadow-lg shadow-emerald-900/40 hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start game — deal hands &amp; track turns
          </button>
        </div>
      )}

      {gameActive && (
        <>
          {/* Slim top bar: life + overflow only */}
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto">
              {opponents.map((p) => {
                const idx = players.findIndex((x) => x.id === p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveSeat(idx)}
                    className={[
                      'flex shrink-0 items-center gap-2 rounded-full border bg-slate-950/80 py-1 pl-1 pr-3',
                      p.hasLost
                        ? 'border-rose-500/40 opacity-60'
                        : p.id === turn.activePlayerId
                          ? 'border-amber-400/60'
                          : 'border-slate-700',
                    ].join(' ')}
                  >
                    <LifeBadge life={p.life} size="sm" lost={p.hasLost} />
                    <span className="max-w-[4.5rem] truncate text-[11px] font-medium text-slate-200">
                      {p.name}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="relative shrink-0">
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-lg text-slate-300 ring-1 ring-slate-700"
                aria-label="Table menu"
                onClick={() => setMenuOpen((v) => !v)}
              >
                ⋯
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-10 z-40 w-44 overflow-hidden rounded-xl border border-slate-700 bg-slate-950 shadow-xl">
                  {mulliganOpen && (
                    <>
                      <MenuItem
                        onClick={() => {
                          keepHand()
                          setMenuOpen(false)
                        }}
                      >
                        Keep hand
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          mulligan()
                          setMenuOpen(false)
                        }}
                      >
                        Mulligan
                      </MenuItem>
                    </>
                  )}
                  {!rulesStrict && (
                    <MenuItem
                      onClick={() => {
                        draw(1)
                        setMenuOpen(false)
                      }}
                    >
                      Draw (debug)
                    </MenuItem>
                  )}
                  <MenuItem
                    onClick={() => {
                      shuffleLibrary()
                      setMenuOpen(false)
                    }}
                  >
                    Shuffle library
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      runAiOpponentStep()
                      setMenuOpen(false)
                    }}
                  >
                    AI step
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      void persistSession()
                      setMenuOpen(false)
                    }}
                  >
                    Save session
                  </MenuItem>
                  <MenuItem
                    onClick={() => {
                      endTurn()
                      setMenuOpen(false)
                    }}
                  >
                    End turn now
                  </MenuItem>
                  <MenuItem
                    danger
                    onClick={() => {
                      endGame()
                      setMenuOpen(false)
                    }}
                  >
                    End game
                  </MenuItem>
                </div>
              )}
            </div>
          </div>

          {player.hasLost && (
            <p className="text-xs font-semibold text-rose-300">
              {player.name} lost
              {player.loseReason === 'decked'
                ? ' — decked'
                : player.loseReason === 'commander_damage'
                  ? ' — 21 commander damage'
                  : player.loseReason === 'life'
                    ? ' — life ≤ 0'
                    : ''}
            </p>
          )}

          {mulliganOpen && (
            <div className="flex gap-2">
              <ActionButton onClick={keepHand} tone="accent">
                Keep hand
              </ActionButton>
              <ActionButton onClick={mulligan}>Mulligan</ActionButton>
            </div>
          )}

          {moveNotice && (
            <div
              role="alert"
              className="sticky top-0 z-30 rounded-lg border-2 border-rose-400 bg-rose-950 px-3 py-3 text-sm font-semibold text-rose-50 shadow-lg shadow-rose-900/40"
            >
              Blocked: {moveNotice}
            </div>
          )}

          {pendingActions.length > 0 && (
            <div className="max-w-xs">
              <StackStub pendingActions={pendingActions} />
            </div>
          )}

          {selectedInstance &&
            (() => {
              const card = player.zones[selectedInstance.zone].find(
                (c) => c.instanceId === selectedInstance.instanceId,
              )
              const legal = getLegalDestinations(
                selectedInstance.zone,
                Boolean(card?.card.isCommander),
                card?.card,
              )
              return (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-100">
                  <span>Move to:</span>
                  {legal.length === 0 && (
                    <span className="text-amber-200">
                      No legal destinations right now.
                    </span>
                  )}
                  {legal.map(({ zone: z }) => (
                    <button
                      key={z}
                      type="button"
                      className="min-h-9 rounded bg-emerald-800/80 px-2 py-1 capitalize"
                      onClick={() => {
                        moveCard(
                          selectedInstance.zone,
                          z,
                          selectedInstance.instanceId,
                        )
                      }}
                    >
                      {z}
                    </button>
                  ))}
                  {selectedInstance.zone === 'battlefield' && (
                    <button
                      type="button"
                      className="min-h-9 rounded bg-amber-800/80 px-2 py-1"
                      onClick={() => toggleTap(selectedInstance.instanceId)}
                    >
                      Tap / Untap
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-slate-400"
                    onClick={() => setSelectedInstance(null)}
                  >
                    Cancel
                  </button>
                </div>
              )
            })()}

          {/* Arena board */}
          <div
            className="arena-board relative overflow-hidden rounded-3xl border-4 border-amber-950/80 shadow-2xl shadow-black/50"
            style={{
              backgroundColor: '#0d3b2e',
              backgroundImage: table.backgroundUrl
                ? `linear-gradient(rgba(8,40,30,0.55), rgba(8,40,30,0.72)), url(${table.backgroundUrl})`
                : 'radial-gradient(ellipse at center, #1a6b4f 0%, #0a2f24 55%, #061a14 100%)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              minHeight: '32rem',
            }}
          >
            <div className="pointer-events-none absolute inset-0 rounded-[1.35rem] ring-1 ring-inset ring-amber-200/10" />

            <div className="relative flex min-h-[32rem] flex-col gap-2 p-2 sm:p-3">
              {/* Opponent strip */}
              {seatCount > 1 && (
                <div className="flex flex-wrap justify-center gap-2">
                  {opponents.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-lg border border-white/10 bg-black/35 px-3 py-1 text-center text-[11px] text-emerald-100/80"
                    >
                      <div className="font-semibold">
                        {p.name}
                        {p.hasLost ? ' ✕' : ''}
                      </div>
                      <div className="text-lg font-bold tabular-nums text-white">
                        {p.life}
                      </div>
                      <div className="text-[10px] text-emerald-200/50">
                        H{p.zones.hand.length} · L{p.zones.library.length}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Top piles */}
              <div className="grid grid-cols-3 gap-1.5">
                <PileZone
                  title="Command"
                  count={player.zones.command.length}
                  {...zoneHandlers('command')}
                >
                  {player.zones.command.map((c) => (
                    <CardChip
                      key={c.instanceId}
                      card={c.card}
                      size="command"
                      draggable
                      selected={selectedInstance?.instanceId === c.instanceId}
                      highlighted={isCardHighlighted('command', c)}
                      onClick={() => openInspect('command', c)}
                      onInspect={() => openInspect('command', c)}
                      onDragStart={() => selectForMove('command', c)}
                    />
                  ))}
                </PileZone>
                <PileZone
                  title="GY"
                  count={player.zones.graveyard.length}
                  {...zoneHandlers('graveyard')}
                >
                  {player.zones.graveyard.slice(-4).map((c) => (
                    <CardChip
                      key={c.instanceId}
                      card={c.card}
                      size="tiny"
                      hideName
                      draggable
                      selected={selectedInstance?.instanceId === c.instanceId}
                      highlighted={isCardHighlighted('graveyard', c)}
                      onClick={() => openInspect('graveyard', c)}
                      onInspect={() => openInspect('graveyard', c)}
                      onDragStart={() => selectForMove('graveyard', c)}
                    />
                  ))}
                </PileZone>
                <PileZone
                  title="Exile"
                  count={player.zones.exile.length}
                  {...zoneHandlers('exile')}
                >
                  {player.zones.exile.slice(-4).map((c) => (
                    <CardChip
                      key={c.instanceId}
                      card={c.card}
                      size="tiny"
                      hideName
                      draggable
                      selected={selectedInstance?.instanceId === c.instanceId}
                      highlighted={isCardHighlighted('exile', c)}
                      onClick={() => openInspect('exile', c)}
                      onInspect={() => openInspect('exile', c)}
                      onDragStart={() => selectForMove('exile', c)}
                    />
                  ))}
                </PileZone>
              </div>

              {/* Combat lane divider */}
              <div className="combat-lane mx-4 h-px bg-gradient-to-r from-transparent via-rose-400/50 to-transparent" />

              {/* Creatures / permanents */}
              <div
                className={[
                  'min-h-[9rem] flex-1 rounded-xl border border-emerald-400/15 bg-black/20 p-2',
                  dragOverZone === 'battlefield' ? 'ring-2 ring-emerald-400/50' : '',
                ].join(' ')}
                onDragOver={zoneHandlers('battlefield').onDragOver}
                onDrop={zoneHandlers('battlefield').onDrop}
              >
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-100/45">
                    Battlefield
                  </span>
                  <span className="text-[10px] tabular-nums text-emerald-100/35">
                    {creatures.length} · {lands.length} lands
                  </span>
                </div>
                {creatures.length === 0 && lands.length === 0 ? (
                  <p className="p-3 text-center text-xs text-emerald-100/30">
                    Empty — tap a card to read, or play from hand
                  </p>
                ) : (
                  <div className="flex flex-wrap content-start items-end gap-2">
                    {creatures.map((c) => (
                      <CardChip
                        key={c.instanceId}
                        card={c.card}
                        size="boardLg"
                        hideName
                        draggable
                        tapped={c.tapped}
                        selected={
                          selectedInstance?.instanceId === c.instanceId
                        }
                        highlighted={isCardHighlighted('battlefield', c)}
                        onClick={() => openInspect('battlefield', c)}
                        onInspect={() => openInspect('battlefield', c)}
                        onDragStart={() => selectForMove('battlefield', c)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Land row — stacked by name */}
              {(landStacks.length > 0 || true) && (
                <div
                  className={[
                    'rounded-xl border border-emerald-400/10 bg-black/25 px-2 py-1.5',
                    dragOverZone === 'battlefield'
                      ? 'ring-1 ring-emerald-400/40'
                      : '',
                  ].join(' ')}
                  onDragOver={zoneHandlers('battlefield').onDragOver}
                  onDrop={zoneHandlers('battlefield').onDrop}
                >
                  <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-emerald-100/40">
                    Lands
                  </div>
                  {landStacks.length === 0 ? (
                    <p className="text-[10px] text-emerald-100/25">No lands</p>
                  ) : (
                    <div className="flex flex-wrap items-end gap-3">
                      {landStacks.map((stack) => {
                        const face = stack.cards[0]!
                        const showTapped = stack.tapped > 0 && stack.untapped === 0
                        return (
                          <button
                            key={stack.key}
                            type="button"
                            className="relative flex flex-col items-center gap-0.5"
                            onClick={() => {
                              // Tap an untapped land in the stack, else inspect
                              const untapped = stack.cards.find((c) => !c.tapped)
                              if (untapped) {
                                toggleTap(untapped.instanceId)
                              } else {
                                openInspect('battlefield', face)
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              openInspect('battlefield', face)
                            }}
                            title={`${stack.name} ×${stack.cards.length} (${stack.untapped} untapped)`}
                          >
                            <div className="relative">
                              {stack.cards.length > 1 && (
                                <span className="absolute -left-1 top-1 h-[85%] w-[85%] rotate-[-8deg] rounded-md bg-slate-800/80 ring-1 ring-black/40" />
                              )}
                              <CardChip
                                card={face.card}
                                size="land"
                                hideName
                                tapped={showTapped}
                                highlighted={stack.cards.some((c) =>
                                  isCardHighlighted('battlefield', c),
                                )}
                              />
                              {stack.cards.length > 1 && (
                                <span className="absolute -right-1 -top-1 z-20 rounded-full bg-slate-950 px-1 text-[9px] font-bold text-amber-200 ring-1 ring-amber-500/40">
                                  ×{stack.cards.length}
                                </span>
                              )}
                            </div>
                            <span className="max-w-[3.5rem] truncate text-[8px] text-emerald-100/50">
                              {stack.untapped}/{stack.cards.length}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* You: life + library + hand */}
              <div className="mt-auto grid grid-cols-[auto_1fr_auto] items-end gap-2">
                <div className="flex flex-col items-center gap-1">
                  <LifeBadge
                    life={player.life}
                    size="lg"
                    active={yourTurn}
                    lost={player.hasLost}
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="h-7 w-7 rounded-full bg-black/50 text-sm text-white"
                      onClick={() => adjustLife(-1)}
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="h-7 w-7 rounded-full bg-black/50 text-sm text-white"
                      onClick={() => adjustLife(1)}
                    >
                      +
                    </button>
                  </div>
                  {seatCount === 1 && (
                    <div className="flex items-center gap-1 text-[9px] text-rose-200/80">
                      <span>Cmd</span>
                      <button
                        type="button"
                        className="h-5 w-5 rounded bg-black/40"
                        onClick={() => adjustCommanderDamage('opp-cmd', -1)}
                      >
                        −
                      </button>
                      <span className="tabular-nums font-bold">
                        {player.commanderDamage['opp-cmd'] ?? 0}
                      </span>
                      <button
                        type="button"
                        className="h-5 w-5 rounded bg-black/40"
                        onClick={() => adjustCommanderDamage('opp-cmd', 1)}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className={[
                    'min-h-[7.5rem] rounded-xl border border-white/10 bg-black/30 p-1',
                    dragOverZone === 'hand' ? 'ring-2 ring-emerald-400/50' : '',
                  ].join(' ')}
                  onDragOver={zoneHandlers('hand').onDragOver}
                  onDrop={zoneHandlers('hand').onDrop}
                >
                  {player.zones.hand.length === 0 ? (
                    <p className="p-2 text-center text-xs text-emerald-100/30">
                      Hand empty
                    </p>
                  ) : (
                    <div className="hand-dock w-full">
                      {player.zones.hand.map((c) => (
                        <div
                          key={c.instanceId}
                          className={[
                            'hand-dock__card',
                            selectedInstance?.instanceId === c.instanceId
                              ? 'is-selected'
                              : '',
                          ].join(' ')}
                        >
                          <CardChip
                            card={c.card}
                            size="hand"
                            draggable
                            selected={
                              selectedInstance?.instanceId === c.instanceId
                            }
                            highlighted={isCardHighlighted('hand', c)}
                            onClick={() => openInspect('hand', c)}
                            onInspect={() => openInspect('hand', c)}
                            onDragStart={() => selectForMove('hand', c)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div
                  className={[
                    'flex w-[4.5rem] flex-col items-center gap-1 rounded-xl border border-white/10 bg-black/30 p-1',
                    dragOverZone === 'library' ? 'ring-2 ring-emerald-400/50' : '',
                  ].join(' ')}
                  onDragOver={zoneHandlers('library').onDragOver}
                  onDrop={zoneHandlers('library').onDrop}
                >
                  <span className="text-[9px] uppercase text-emerald-100/40">
                    Lib {player.zones.library.length}
                  </span>
                  <div className="flex justify-center">
                    {player.zones.library.slice(0, 1).map((c) => (
                      <CardChip
                        key={c.instanceId}
                        card={c.card}
                        size="tiny"
                        faceDown
                      />
                    ))}
                  </div>
                  {(() => {
                    const libLegal = new Set(
                      getLegalDestinations('library').map((l) => l.zone),
                    )
                    return (
                      <div className="flex w-full flex-col gap-0.5">
                        {libLegal.has('hand') && (
                          <TinyButton onClick={() => moveTopLibraryTo('hand')}>
                            → Hand
                          </TinyButton>
                        )}
                        {libLegal.has('battlefield') && (
                          <TinyButton
                            onClick={() => moveTopLibraryTo('battlefield')}
                          >
                            → BF
                          </TinyButton>
                        )}
                        {libLegal.has('graveyard') && (
                          <TinyButton
                            onClick={() => moveTopLibraryTo('graveyard')}
                          >
                            → GY
                          </TinyButton>
                        )}
                        {!rulesStrict && (
                          <TinyButton
                            onClick={() =>
                              grantPendingAction('mill', 3, 'Mill 3')
                            }
                          >
                            Mill
                          </TinyButton>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          </div>

          <PhaseRail
            dock
            phase={turn.phase}
            turnNumber={turn.turnNumber}
            activeName={activeName}
            yourTurn={yourTurn}
            lastAutoNote={turn.lastAutoNote}
            stops={stops}
            combatEntered={Boolean(turn.combatEntered)}
            attackersDeclared={Boolean(turn.attackersDeclared)}
            onPass={passPriority}
            onStep={nextPhase}
            onToggleStop={togglePhaseStop}
            onEnterCombat={enterCombat}
          />
        </>
      )}

      {inspect && (
        <CardDetailOverlay
          card={inspect.card}
          onClose={() => setInspect(null)}
          onSelectForMove={() => {
            setSelectedInstance({
              playerId: player.id,
              zone: inspect.zone,
              instanceId: inspect.instanceId,
            })
            setInspect(null)
          }}
          onToggleTap={
            inspect.zone === 'battlefield'
              ? () => {
                  toggleTap(inspect.instanceId)
                }
              : undefined
          }
        />
      )}

      <aside className="rounded-xl border border-slate-800 bg-slate-900/50 p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Session log
        </h2>
        <ul className="max-h-24 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
          {log.map((line, i) => (
            <li key={`${i}-${line.slice(0, 16)}`}>{line}</li>
          ))}
        </ul>
      </aside>
    </div>
  )
}

function LifeBadge({
  life,
  size = 'md',
  active = false,
  lost = false,
}: {
  life: number
  size?: 'sm' | 'md' | 'lg'
  active?: boolean
  lost?: boolean
}) {
  const dim =
    size === 'lg'
      ? 'h-16 w-16 text-2xl'
      : size === 'sm'
        ? 'h-9 w-9 text-sm'
        : 'h-12 w-12 text-lg'
  return (
    <span
      className={[
        'life-badge inline-flex items-center justify-center rounded-full font-black tabular-nums',
        dim,
        lost
          ? 'bg-rose-950 text-rose-300 ring-2 ring-rose-500/50'
          : active
            ? 'bg-gradient-to-b from-amber-300 to-amber-600 text-slate-950 shadow-[0_0_16px_rgba(251,191,36,0.45)] ring-2 ring-amber-200/80'
            : 'bg-slate-950 text-amber-100 ring-2 ring-amber-500/50',
      ].join(' ')}
    >
      {life}
    </span>
  )
}

function PileZone({
  title,
  count,
  children,
  onDragOver,
  onDrop,
  dropActive,
}: {
  title: string
  count: number
  children: ReactNode
  onDragOver: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
  dropActive?: boolean
}) {
  return (
    <div
      className={[
        'rounded-xl border border-white/10 bg-black/30 p-1.5',
        dropActive ? 'ring-2 ring-emerald-400/50' : '',
      ].join(' ')}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="mb-1 flex justify-between px-0.5 text-[9px] uppercase tracking-wider text-emerald-100/40">
        <span>{title}</span>
        <span className="tabular-nums">{count}</span>
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'block w-full px-3 py-2.5 text-left text-xs',
        danger
          ? 'text-rose-300 hover:bg-rose-950/50'
          : 'text-slate-200 hover:bg-slate-800',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

function ActionButton({
  children,
  onClick,
  tone = 'default',
  title,
}: {
  children: ReactNode
  onClick: () => void
  tone?: 'default' | 'muted' | 'accent'
  title?: string
}) {
  const cls =
    tone === 'muted'
      ? 'min-h-9 rounded-md px-2.5 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      : tone === 'accent'
        ? 'min-h-9 rounded-md bg-amber-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-500'
        : 'min-h-9 rounded-md bg-emerald-700/90 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-600'
  return (
    <button type="button" onClick={onClick} className={cls} title={title}>
      {children}
    </button>
  )
}

function TinyButton({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-6 w-full rounded bg-black/40 px-1 py-0.5 text-[9px] text-emerald-100/80 ring-1 ring-emerald-500/20"
    >
      {children}
    </button>
  )
}

