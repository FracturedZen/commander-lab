/**
 * Map Phase WASM ClientGameState → Arena board view models.
 * Display-only: legality always comes from engine legal actions.
 */

import type { CardInstance, CardRef } from '@/types/card'
import { isLand } from '@/types/card'
import type { Phase as LabPhase } from '@/lib/rules/turnMachine'
import type { PhaseGameAction, PhaseLegalActions } from './types'
import { hydrateCardRefs } from '@/lib/scryfall/hydrate'

export type PhaseZoneName =
  | 'library'
  | 'hand'
  | 'battlefield'
  | 'graveyard'
  | 'exile'
  | 'command'

export type PhaseObjectView = CardInstance & {
  /** Phase ObjectId as string */
  objectId: string
  zoneName: PhaseZoneName
  owner: number
  controller: number
  faceDown?: boolean
  visible?: boolean
}

/** One mana pip from Phase player.mana_pool.mana (display + SpendPoolMana). */
export type PhaseManaPip = {
  pipId: number
  color: string
  sourceId?: number
  restrictions: string[]
}

export type PhaseSeatView = {
  id: number
  life: number
  libraryCount: number
  hand: PhaseObjectView[]
  battlefield: PhaseObjectView[]
  lands: PhaseObjectView[]
  nonLands: PhaseObjectView[]
  graveyard: PhaseObjectView[]
  exile: PhaseObjectView[]
  command: PhaseObjectView[]
  /** Exact Phase mana_pool.mana rows for this seat (empty if absent). */
  manaPool: PhaseManaPip[]
  isEliminated?: boolean
}

export type PhaseBoardView = {
  ok: boolean
  reason?: string
  turnNumber: number
  activePlayer: number
  priorityPlayer: number
  phaseRaw: string
  phase: LabPhase
  waitingFor?: string
  /** Full waiting_for payload for combat / mulligan UX */
  waitingRaw?: unknown
  gameOver: boolean
  seats: PhaseSeatView[]
  stackCount: number
  /** objectId → legal actions (stripped of interactionActionId) */
  actionsByObject: Record<string, PhaseGameAction[]>
  flatActions: PhaseGameAction[]
  autoPass: boolean
  /** Exact Phase mana-payment shortcut taps (TapLandForMana with one option). */
  manaPaymentShortcutActions: PhaseGameAction[]
  /** pending_cast.pinned_pool_units — pip ids already spent toward the cost. */
  pinnedPoolUnits: number[]
}

type RawObj = {
  id?: number | string
  name?: string
  zone?: string
  owner?: number
  controller?: number
  tapped?: boolean
  face_down?: boolean
  display_visible_to_viewer?: boolean
  power?: number | null
  toughness?: number | null
  card_types?: { types?: string[]; subtypes?: string[]; supertypes?: string[] } | string[]
  mana_cost?: { pips?: unknown[]; converted?: number } | string
  is_commander?: boolean
  is_token?: boolean
  [key: string]: unknown
}

type RawPlayer = {
  id?: number
  life?: number
  library?: Array<number | string>
  hand?: Array<number | string>
  graveyard?: Array<number | string>
  is_eliminated?: boolean
}

type RawState = {
  turn_number?: number
  active_player?: number
  priority_player?: number
  phase?: string | { type?: string }
  players?: RawPlayer[]
  objects?: Record<string, RawObj>
  battlefield?: Array<number | string>
  exile?: Array<number | string>
  command_zone?: Array<number | string>
  stack?: unknown[]
  waiting_for?: { type?: string; data?: unknown } | string | null
  game_over?: boolean
  eliminated_players?: number[]
  [key: string]: unknown
}

/** Flatten ClientGameState { state, derived } envelope. */
export function unwrapPhaseState(raw: unknown): RawState | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { state?: RawState; derived?: unknown }
  if (r.state && typeof r.state === 'object') {
    const derived = (r as { derived?: unknown }).derived
    return {
      ...r.state,
      derived: derived ?? (r.state as RawState).derived,
    }
  }
  return raw as RawState
}

export function mapPhaseStepToLab(step: string): LabPhase {
  switch (step) {
    case 'Untap':
      return 'untap'
    case 'Upkeep':
      return 'upkeep'
    case 'Draw':
      return 'draw'
    case 'PreCombatMain':
      return 'main1'
    case 'BeginCombat':
      return 'combat_begin'
    case 'DeclareAttackers':
      return 'combat_attackers'
    case 'DeclareBlockers':
      return 'combat_blockers'
    case 'CombatDamage':
      return 'combat_damage'
    case 'EndCombat':
      return 'combat_end'
    case 'PostCombatMain':
      return 'main2'
    case 'End':
    case 'Cleanup':
      return 'end'
    default:
      return 'main1'
  }
}

function phaseString(raw: RawState): string {
  const p = raw.phase
  if (typeof p === 'string') return p
  if (p && typeof p === 'object' && typeof p.type === 'string') return p.type
  return 'PreCombatMain'
}

function waitingType(raw: RawState): string | undefined {
  const w = raw.waiting_for
  if (!w) return undefined
  if (typeof w === 'string') return w
  if (typeof w === 'object' && typeof w.type === 'string') return w.type
  return undefined
}

function idKey(id: number | string | undefined): string {
  return String(id ?? '')
}

function typeLineFromObj(obj: RawObj): string {
  const ct = obj.card_types as
    | { supertypes?: string[]; core_types?: string[]; types?: string[]; subtypes?: string[] }
    | string[]
    | undefined
  if (!ct) return ''
  if (Array.isArray(ct)) return ct.join(' ')
  const supers = ct.supertypes?.join(' ') ?? ''
  const types = (ct.core_types ?? ct.types ?? []).join(' ')
  const subs = ct.subtypes?.length ? ` — ${ct.subtypes.join(' ')}` : ''
  return `${supers} ${types}${subs}`.trim()
}

function manaCostString(obj: RawObj): string | undefined {
  const mc = obj.mana_cost as
    | string
    | { type?: string; shards?: string[]; generic?: number }
    | undefined
  if (!mc) return undefined
  if (typeof mc === 'string') return mc
  if (mc.type === 'NoCost') return undefined
  if (mc.type === 'Cost') {
    const g = mc.generic && mc.generic > 0 ? `{${mc.generic}}` : ''
    const shards = (mc.shards ?? []).map((s) => `{${s[0] ?? s}}`).join('')
    return `${g}${shards}` || undefined
  }
  return undefined
}

function stubCardFromObj(obj: RawObj): CardRef {
  const name =
    obj.display_visible_to_viewer === false || obj.face_down
      ? 'Facedown card'
      : (obj.name ?? 'Unknown')
  const typeLine = typeLineFromObj(obj)
  return {
    id: `phase:${idKey(obj.id)}`,
    name,
    typeLine: typeLine || undefined,
    manaCost: manaCostString(obj),
    power: obj.power != null ? String(obj.power) : undefined,
    toughness: obj.toughness != null ? String(obj.toughness) : undefined,
    isCommander: obj.is_commander === true,
  }
}


function toView(obj: RawObj, zoneName: PhaseZoneName): PhaseObjectView {
  const oid = idKey(obj.id)
  const visible = obj.display_visible_to_viewer !== false && !obj.face_down
  return {
    instanceId: oid,
    objectId: oid,
    zoneName,
    owner: obj.owner ?? 0,
    controller: obj.controller ?? obj.owner ?? 0,
    tapped: Boolean(obj.tapped),
    faceDown: Boolean(obj.face_down) || obj.display_visible_to_viewer === false,
    visible,
    card: stubCardFromObj(obj),
  }
}

function resolveIds(
  ids: Array<number | string> | undefined,
  objects: Record<string, RawObj>,
  zoneName: PhaseZoneName,
  ownerFilter?: number,
): PhaseObjectView[] {
  if (!ids) return []
  const out: PhaseObjectView[] = []
  for (const id of ids) {
    const obj = objects[idKey(id)]
    if (!obj) continue
    if (ownerFilter != null && obj.owner !== ownerFilter) continue
    out.push(toView(obj, zoneName))
  }
  return out
}

/** Strip interactionActionId from ObjectActionPayload flatten. */
export function stripObjectAction(raw: unknown): PhaseGameAction | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = r.type
  if (typeof type !== 'string') return null
  const { interactionActionId: _i, interaction_action_id: _j, ...rest } = r
  void _i
  void _j
  if ('data' in rest) return { type, data: rest.data }
  // flattened without data key — rebuild data from remaining fields
  const { type: _t, ...data } = rest as { type: string; [k: string]: unknown }
  void _t
  if (Object.keys(data).length === 0) return { type }
  return { type, data }
}

export function normalizeLegalActions(raw: PhaseLegalActions | unknown): {
  actions: PhaseGameAction[]
  actionsByObject: Record<string, PhaseGameAction[]>
  autoPass: boolean
  manaPaymentShortcutActions: PhaseGameAction[]
} {
  if (!raw || typeof raw !== 'object') {
    return { actions: [], actionsByObject: {}, autoPass: false, manaPaymentShortcutActions: [] }
  }
  const r = raw as Record<string, unknown>
  const actions = Array.isArray(r.actions) ? (r.actions as PhaseGameAction[]) : []
  const autoPass = Boolean(r.autoPassRecommended ?? r.auto_pass_recommended ?? r.auto_pass)
  const manaPaymentShortcutActions = (
    (Array.isArray(r.manaPaymentShortcutActions) && r.manaPaymentShortcutActions) ||
    (Array.isArray(r.mana_payment_shortcut_actions) && r.mana_payment_shortcut_actions) ||
    []
  ) as PhaseGameAction[]

  const byObjRaw =
    (r.legalActionsByObject as Record<string, unknown[]> | undefined) ??
    (r.legal_actions_by_object as Record<string, unknown[]> | undefined) ??
    {}

  const actionsByObject: Record<string, PhaseGameAction[]> = {}
  for (const [oid, list] of Object.entries(byObjRaw)) {
    if (!Array.isArray(list)) continue
    const mapped = list
      .map(stripObjectAction)
      .filter((a): a is PhaseGameAction => a != null)
    if (mapped.length) actionsByObject[oid] = mapped
  }

  // Heuristic fallback: index flat actions by object_id / source_id
  if (Object.keys(actionsByObject).length === 0) {
    for (const a of actions) {
      const d = a.data as Record<string, unknown> | undefined
      if (!d) continue
      const oid =
        d.object_id ?? d.source_id ?? d.hand_object ?? d.equipment_id ?? d.vehicle_id
      if (oid == null) continue
      const key = String(oid)
      if (!actionsByObject[key]) actionsByObject[key] = []
      actionsByObject[key].push(a)
    }
  }

  return { actions, actionsByObject, autoPass, manaPaymentShortcutActions }
}


function parseManaPool(p: RawPlayer): PhaseManaPip[] {
  const pool = (p as { mana_pool?: { mana?: unknown[] } }).mana_pool
  const mana = pool?.mana
  if (!Array.isArray(mana)) return []
  const out: PhaseManaPip[] = []
  for (const row of mana) {
    if (!row || typeof row !== 'object') continue
    const r = row as Record<string, unknown>
    const pipId = typeof r.pip_id === 'number' ? r.pip_id : typeof r.pipId === 'number' ? r.pipId : null
    if (pipId == null) continue
    const color = typeof r.color === 'string' ? r.color : 'Colorless'
    const restrictions = Array.isArray(r.restrictions)
      ? r.restrictions.map(String)
      : []
    const sourceId =
      typeof r.source_id === 'number'
        ? r.source_id
        : typeof r.sourceId === 'number'
          ? r.sourceId
          : undefined
    out.push({ pipId, color, sourceId, restrictions })
  }
  return out
}

function parsePinnedPoolUnits(state: RawState): number[] {
  const pc = state.pending_cast as { pinned_pool_units?: unknown } | undefined
  const raw = pc?.pinned_pool_units
  if (!Array.isArray(raw)) return []
  return raw
    .map((n) => (typeof n === 'number' ? n : Number(n)))
    .filter((n) => Number.isFinite(n))
}

export function buildPhaseBoardView(
  stateRaw: unknown,
  legalRaw: PhaseLegalActions | unknown,
): PhaseBoardView {
  const state = unwrapPhaseState(stateRaw)
  const { actions, actionsByObject, autoPass, manaPaymentShortcutActions } = normalizeLegalActions(legalRaw)

  if (!state?.players || !state.objects) {
    return {
      ok: false,
      reason: 'Phase state missing players/objects — showing action list only',
      turnNumber: 0,
      activePlayer: 0,
      priorityPlayer: 0,
      phaseRaw: '—',
      phase: 'main1',
      gameOver: false,
      seats: [],
      stackCount: 0,
      actionsByObject,
      flatActions: actions,
      autoPass,
      manaPaymentShortcutActions,
      pinnedPoolUnits: [],
    }
  }

  const objects = state.objects
  const phaseRaw = phaseString(state)
  const seats: PhaseSeatView[] = state.players.map((p, idx) => {
    const id = p.id ?? idx
    const hand = resolveIds(p.hand, objects, 'hand')
    const gy = resolveIds(p.graveyard, objects, 'graveyard')
    const libCount = p.library?.length ?? 0

    // Battlefield: prefer global list filtered by controller
    const bfIds = state.battlefield ?? []
    const bf = resolveIds(bfIds, objects, 'battlefield').filter(
      (v) => v.controller === id || v.owner === id,
    )
    // Also catch objects that claim Battlefield but aren't in the list
    if (bf.length === 0) {
      for (const obj of Object.values(objects)) {
        if (obj.zone === 'Battlefield' && (obj.controller === id || obj.owner === id)) {
          bf.push(toView(obj, 'battlefield'))
        }
      }
    }

    const lands = bf.filter((c) => isLand(c.card) || c.card.typeLine?.includes('Land'))
    const nonLands = bf.filter((c) => !lands.includes(c))

    const exile = resolveIds(state.exile, objects, 'exile', id)
    const command = resolveIds(state.command_zone, objects, 'command', id)

    return {
      id,
      life: typeof p.life === 'number' ? p.life : 40,
      libraryCount: libCount,
      hand,
      battlefield: bf,
      lands,
      nonLands,
      graveyard: gy,
      exile,
      command,
      manaPool: parseManaPool(p),
      isEliminated: p.is_eliminated || state.eliminated_players?.includes(id),
    }
  })

  return {
    ok: true,
    turnNumber: state.turn_number ?? 1,
    activePlayer: state.active_player ?? 0,
    priorityPlayer: state.priority_player ?? state.active_player ?? 0,
    phaseRaw,
    phase: mapPhaseStepToLab(phaseRaw),
    waitingFor: waitingType(state),
    waitingRaw: state.waiting_for ?? null,
    gameOver: Boolean(state.game_over),
    seats,
    stackCount: Array.isArray(state.stack) ? state.stack.length : 0,
    actionsByObject,
    flatActions: actions,
    autoPass,
    manaPaymentShortcutActions,
    pinnedPoolUnits: parsePinnedPoolUnits(state),
  }
}

/** Hydrate Scryfall art onto board card stubs (mutates views in place via new cards). */
export async function hydrateBoardArt(view: PhaseBoardView): Promise<PhaseBoardView> {
  if (!view.ok) return view
  const stubs: CardRef[] = []
  const seen = new Set<string>()
  for (const seat of view.seats) {
    for (const zone of [
      seat.hand,
      seat.nonLands,
      seat.lands,
      seat.graveyard,
      seat.exile,
      seat.command,
    ]) {
      for (const c of zone) {
        if (c.faceDown) continue
        const key = c.card.name
        if (seen.has(key)) continue
        seen.add(key)
        stubs.push(c.card)
      }
    }
  }
  if (stubs.length === 0) return view
  const hydrated = await hydrateCardRefs(stubs)
  const byName = new Map(hydrated.map((c) => [c.name, c]))

  function apply(list: PhaseObjectView[]): PhaseObjectView[] {
    return list.map((v) => {
      if (v.faceDown) return v
      const h = byName.get(v.card.name)
      if (!h) return v
      return {
        ...v,
        card: {
          ...v.card,
          ...h,
          id: v.card.id,
          isCommander: v.card.isCommander ?? h.isCommander,
          // Prefer engine live P/T when present
          power: v.card.power ?? h.power,
          toughness: v.card.toughness ?? h.toughness,
        },
      }
    })
  }

  return {
    ...view,
    seats: view.seats.map((s) => {
      const hand = apply(s.hand)
      const nonLands = apply(s.nonLands)
      const lands = apply(s.lands)
      const graveyard = apply(s.graveyard)
      const exile = apply(s.exile)
      const command = apply(s.command)
      return {
        ...s,
        hand,
        nonLands,
        lands,
        battlefield: [...nonLands, ...lands],
        graveyard,
        exile,
        command,
      }
    }),
  }
}

export function summarizeAction(a: PhaseGameAction): string {
  const t = a.type
  const d = a.data as Record<string, unknown> | undefined
  if (!d) return t
  const bits = Object.entries(d)
    .slice(0, 4)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 40) : v}`)
  return `${t}(${bits.join(', ')})`
}

/** Prefer a single safe auto-dispatch action for an object tap. */
export function pickPrimaryAction(actions: PhaseGameAction[]): PhaseGameAction | null {
  if (actions.length === 0) return null
  if (actions.length === 1) return actions[0]!
  const prefer = [
    'PlayLand',
    'CastSpell',
    'CastSpellForFree',
    'TapLandForMana',
    'ActivateManaSource',
    'ActivateAbility',
  ]
  for (const t of prefer) {
    const hit = actions.find((a) => a.type === t)
    if (hit) return hit
  }
  return actions[0] ?? null
}
