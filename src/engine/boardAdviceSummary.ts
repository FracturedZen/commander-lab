import type { PhaseBoardView, PhaseObjectView, PhaseSeatView } from './phaseStateView'
import { summarizeAction } from './phaseStateView'
import type { PhaseGameAction } from './types'

const MAX_HAND = 12
const MAX_BF = 10
const MAX_ACTIONS = 22
const MAX_STACK = 4

function cardLabel(c: PhaseObjectView): string {
  const name = c.card?.name || '?'
  const pow = c.card?.power
  const tou = c.card?.toughness
  const pt = pow != null && tou != null ? ` ${pow}/${tou}` : ''
  const tap = c.tapped ? ' (T)' : ''
  return `${name}${pt}${tap}`
}

function waitingLabel(raw: unknown, fallback?: string): string {
  if (fallback) return fallback
  if (raw == null) return 'none'
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if (typeof o.type === 'string') return o.type
    if (typeof o.kind === 'string') return o.kind
    const keys = Object.keys(o)
    if (keys.length === 1) return keys[0]!
    if (keys.length > 0) return keys.slice(0, 3).join('|')
  }
  return 'unknown'
}

function seatLine(seat: PhaseSeatView, label: string): string[] {
  const lines: string[] = []
  const elim = seat.isEliminated ? ' [ELIMINATED]' : ''
  const poison = seat.poison > 0 ? ` · poison ${seat.poison}` : ''
  lines.push(
    `${label} (seat ${seat.id}): life ${seat.life}${poison} · library ${seat.libraryCount} · hand ${seat.hand.length}${elim}`,
  )
  if (seat.command.length) {
    lines.push(
      `  command: ${seat.command.map((c) => c.card?.name || '?').join(', ')}`,
    )
  }
  if (seat.commanderDamage?.length) {
    const bits = seat.commanderDamage
      .slice(0, 4)
      .map((d) => `${d.commanderName || d.commanderId}:${d.damage}`)
    if (bits.length) lines.push(`  cmd dmg: ${bits.join(', ')}`)
  }
  const lands = seat.lands?.length ?? 0
  const tappedLands = (seat.lands ?? []).filter((l) => l.tapped).length
  if (lands) lines.push(`  lands: ${lands} (${tappedLands} tapped)`)
  const permanents = (seat.nonLands ?? seat.battlefield ?? []).slice(0, MAX_BF)
  if (permanents.length) {
    lines.push(`  BF: ${permanents.map(cardLabel).join('; ')}`)
    const extra = (seat.nonLands ?? seat.battlefield ?? []).length - permanents.length
    if (extra > 0) lines.push(`  BF … +${extra} more`)
  }
  return lines
}

function actionLabel(a: PhaseGameAction, view: PhaseBoardView): string {
  const base = summarizeAction(a)
  const d = a.data as Record<string, unknown> | undefined
  const oid = d?.object_id ?? d?.objectId ?? d?.source_id ?? d?.sourceId
  if (oid != null) {
    const id = String(oid)
    const named =
      view.objectNames[id] ||
      view.seats
        .flatMap((s) => [...s.hand, ...s.battlefield, ...s.command])
        .find((c) => c.objectId === id)?.card?.name
    if (named) return `${a.type} · ${named}`
  }
  return base.length > 90 ? base.slice(0, 87) + '…' : base
}

/**
 * Compact live-board summary for OpenRouter coach prompts.
 * Intentionally small — no full legal payloads or card dumps.
 */
export function buildEngineAdviceSummary(view: PhaseBoardView): string {
  const lines: string[] = []
  lines.push(
    `Turn ${view.turnNumber} · phase ${view.phaseRaw || view.phase} · active P${view.activePlayer} · priority P${view.priorityPlayer}`,
  )
  lines.push(`Waiting: ${waitingLabel(view.waitingRaw, view.waitingFor)}`)
  if (view.gameOver) lines.push('Game over: yes')

  const you = view.seats[0]
  const opps = view.seats.slice(1)
  if (you) {
    lines.push('')
    lines.push(...seatLine(you, 'You'))
    const hand = you.hand.slice(0, MAX_HAND)
    if (hand.length) {
      lines.push(`  hand: ${hand.map((c) => c.card?.name || '?').join(', ')}`)
      if (you.hand.length > hand.length) {
        lines.push(`  hand … +${you.hand.length - hand.length} more`)
      }
    } else {
      lines.push('  hand: (empty)')
    }
    const pool = you.manaPool ?? []
    if (pool.length) {
      const counts: Record<string, number> = {}
      for (const p of pool) {
        const k = String(p.color ?? '?')
        counts[k] = (counts[k] ?? 0) + 1
      }
      lines.push(
        `  mana pool: ${Object.entries(counts)
          .map(([k, n]) => `${n}${k}`)
          .join(' ')}`,
      )
    }
  }
  for (const opp of opps) {
    lines.push('')
    lines.push(...seatLine(opp, 'Opponent'))
  }

  lines.push('')
  const stackN = view.stackCount || view.stackGroups.length
  lines.push(`Stack (${stackN}):`)
  const groups = view.stackGroups.slice(-MAX_STACK)
  if (!groups.length) lines.push('  (empty)')
  for (const g of groups) {
    const top = g.isTop ? ' [TOP]' : ''
    lines.push(
      `  ${g.name || g.kindLabel}${g.count > 1 ? ` ×${g.count}` : ''}${top}` +
        (g.controller != null ? ` (P${g.controller})` : ''),
    )
  }

  lines.push('')
  lines.push('Legal action labels (Phase):')
  const seen = new Set<string>()
  const labels: string[] = []
  for (const a of view.flatActions) {
    const lab = actionLabel(a, view)
    if (seen.has(lab)) continue
    seen.add(lab)
    labels.push(lab)
    if (labels.length >= MAX_ACTIONS) break
  }
  if (!labels.length) lines.push('  (none listed)')
  for (const lab of labels) lines.push(`  - ${lab}`)
  if (view.flatActions.length > labels.length) {
    lines.push(`  … +${view.flatActions.length - labels.length} more legal`)
  }
  if (view.autoPass) lines.push('Auto-pass recommended by Phase: yes')

  return lines.join('\n')
}
