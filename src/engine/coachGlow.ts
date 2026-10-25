import type { PhaseBoardView } from './phaseStateView'
import { summarizeAction } from './phaseStateView'

export type CoachGlowMatch = {
  /** Line or fragment from advice text. */
  label: string
  objectIds: string[]
  actionTypes: string[]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/** Collect name → objectIds that currently have legal actions (glow candidates). */
function legalNameIndex(view: PhaseBoardView): Map<string, string[]> {
  const map = new Map<string, string[]>()
  const add = (name: string, oid: string) => {
    const key = normalize(name)
    if (!key || key.length < 3) return
    const arr = map.get(key) ?? []
    if (!arr.includes(oid)) arr.push(oid)
    map.set(key, arr)
  }
  for (const [oid, acts] of Object.entries(view.actionsByObject)) {
    if (!acts?.length) continue
    const fromZones = view.seats
      .flatMap((s) => [...s.hand, ...s.battlefield, ...s.command, ...s.lands])
      .find((c) => c.objectId === oid)
    const named =
      view.objectNames[oid] ||
      fromZones?.card?.name ||
      ''
    if (named) add(String(named), oid)
  }
  return map
}

/**
 * Match advice text against current legal glows / action labels.
 * Returns clickable suggestions that focus board highlights — never submits.
 */
export function matchAdviceToGlows(
  adviceText: string,
  view: PhaseBoardView,
): CoachGlowMatch[] {
  const nameIndex = legalNameIndex(view)
  const actionLabels = view.flatActions.map((a) => ({
    type: a.type,
    summary: summarizeAction(a),
  }))
  const lines = adviceText
    .split(/\n+/)
    .map((l) => l.replace(/^[\s•\-\*\d.]+/, '').trim())
    .filter((l) => l.length >= 4)

  const out: CoachGlowMatch[] = []
  const seen = new Set<string>()

  for (const line of lines) {
    const normLine = normalize(line)
    const objectIds: string[] = []
    const actionTypes: string[] = []

    for (const [name, ids] of nameIndex) {
      if (normLine.includes(name)) {
        for (const id of ids) {
          if (!objectIds.includes(id)) objectIds.push(id)
        }
      }
    }
    for (const a of actionLabels) {
      const t = normalize(a.type)
      if (t.length >= 4 && normLine.includes(t.replace(/\s+/g, ' '))) {
        if (!actionTypes.includes(a.type)) actionTypes.push(a.type)
      }
      // CastSpell · CardName style from our summary
      const short = normalize(a.type.replace(/([a-z])([A-Z])/g, '$1 $2'))
      if (short.length >= 4 && normLine.includes(short) && !actionTypes.includes(a.type)) {
        actionTypes.push(a.type)
      }
    }

    // If action types matched but no objects, pull objects for those types
    if (objectIds.length === 0 && actionTypes.length) {
      for (const [oid, acts] of Object.entries(view.actionsByObject)) {
        if (acts.some((a) => actionTypes.includes(a.type))) {
          objectIds.push(oid)
        }
      }
    }

    if (objectIds.length === 0 && actionTypes.length === 0) continue
    const key = objectIds.join(',') + '|' + actionTypes.join(',')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      label: line.length > 72 ? line.slice(0, 69) + '…' : line,
      objectIds,
      actionTypes,
    })
    if (out.length >= 8) break
  }
  return out
}
