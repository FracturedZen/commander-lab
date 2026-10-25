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

export type PhaseCommanderDamageBadge = {
  commanderId: string
  commanderName: string
  damage: number
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
  /** Phase player.poison_counters (CR 704.5c). */
  poison: number
  /** Commander damage this seat has received (from derived.commander_damage_by_attacker). */
  commanderDamage: PhaseCommanderDamageBadge[]
}

/** One coalesced stack group from Phase derived.stack_display_groups. */
export type PhaseStackGroupView = {
  representativeId: string
  count: number
  memberIds: string[]
  /** True for the last group in Phase stack order (resolves first). */
  isTop: boolean
  name: string
  kindLabel: string
  description?: string
  controller?: number
  targetLabels: string[]
  /** Chip when the representative object is resolvable for art. */
  chip?: PhaseObjectView
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
  /** Phase derived.stack_display_groups (+ entry details), bottom→top order. */
  stackGroups: PhaseStackGroupView[]
  /** objectId → legal actions (stripped of interactionActionId) */
  actionsByObject: Record<string, PhaseGameAction[]>
  flatActions: PhaseGameAction[]
  autoPass: boolean
  /** Exact Phase mana-payment shortcut taps (TapLandForMana with one option). */
  manaPaymentShortcutActions: PhaseGameAction[]
  /** pending_cast.pinned_pool_units — pip ids already spent toward the cost. */
  pinnedPoolUnits: number[]
  /** object id → oracle/name for off-board WaitingFor modals (library search/scry). */
  objectNames: Record<string, string>
  /**
   * Phase `spellCosts` — effective mana cost per object id (includes commander tax /
   * reductions). Present even when the spell is not currently castable.
   */
  spellCosts: Record<string, unknown>
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
  poison_counters?: number
  poisonCounters?: number
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
  spellCosts: Record<string, unknown>
} {
  if (!raw || typeof raw !== 'object') {
    return {
      actions: [],
      actionsByObject: {},
      autoPass: false,
      manaPaymentShortcutActions: [],
      spellCosts: {},
    }
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

  // Always merge flat cast/activate/play/foretell under their object so command-zone
  // CastSpell and ActivateAbility glow even if by_object omitted a key.
  for (const a of actions) {
    if (
      a.type !== 'ActivateAbility' &&
      a.type !== 'PlayLand' &&
      a.type !== 'Foretell' &&
      a.type !== 'CastSpell' &&
      a.type !== 'CastSpellForFree' &&
      a.type !== 'CastSpellAsSneak' &&
      a.type !== 'CastSpellAsWebSlinging' &&
      a.type !== 'CastSpellAsMiracle' &&
      a.type !== 'CastSpellAsMadness'
    ) {
      continue
    }
    const d = a.data as Record<string, unknown> | undefined
    if (!d) continue
    const oid = d.object_id ?? d.source_id ?? d.hand_object
    if (oid == null) continue
    const key = String(oid)
    const list = actionsByObject[key] ?? (actionsByObject[key] = [])
    const already = list.some((x) => {
      if (x.type !== a.type) return false
      const xd = x.data as Record<string, unknown> | undefined
      if (a.type === 'ActivateAbility') {
        return (
          (xd?.ability_index ?? xd?.abilityIndex) ===
            (d.ability_index ?? d.abilityIndex) &&
          String(xd?.source_id ?? xd?.sourceId) === String(d.source_id ?? d.sourceId)
        )
      }
      return String(xd?.object_id ?? xd?.source_id) === String(oid)
    })
    if (!already) list.push(a)
  }

  const spellCostsRaw =
    (r.spellCosts as Record<string, unknown> | undefined) ??
    (r.spell_costs as Record<string, unknown> | undefined) ??
    {}
  const spellCosts: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(spellCostsRaw)) {
    spellCosts[String(k)] = v
  }

  return { actions, actionsByObject, autoPass, manaPaymentShortcutActions, spellCosts }
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

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function parseCommanderDamageForSeats(
  derived: unknown,
  objectNames: Record<string, string>,
  seatIds: number[],
): Map<number, PhaseCommanderDamageBadge[]> {
  const out = new Map<number, PhaseCommanderDamageBadge[]>()
  for (const id of seatIds) out.set(id, [])
  const d = asRec(derived)
  if (!d) return out
  const byAtk =
    asRec(d.commander_damage_by_attacker) ??
    asRec(d.commanderDamageByAttacker)
  if (!byAtk) return out
  for (const entries of Object.values(byAtk)) {
    if (!Array.isArray(entries)) continue
    for (const raw of entries) {
      const e = asRec(raw)
      if (!e) continue
      const victim =
        typeof e.victim === 'number'
          ? e.victim
          : typeof e.victim === 'string'
            ? Number(e.victim)
            : NaN
      if (!Number.isFinite(victim) || !out.has(victim)) continue
      const commanderId = String(e.commander ?? e.commander_id ?? e.commanderId ?? '?')
      const damage = typeof e.damage === 'number' ? e.damage : 0
      if (damage <= 0) continue
      out.get(victim)!.push({
        commanderId,
        commanderName: objectNames[commanderId] || `Commander #${commanderId}`,
        damage,
      })
    }
  }
  return out
}

function parseStackGroups(
  state: RawState,
  objects: Record<string, RawObj>,
  objectNames: Record<string, string>,
): PhaseStackGroupView[] {
  const derived = asRec(state.derived)
  const groupsRaw =
    (derived && Array.isArray(derived.stack_display_groups) && derived.stack_display_groups) ||
    (derived && Array.isArray(derived.stackDisplayGroups) && derived.stackDisplayGroups) ||
    null
  const detailsRaw =
    asRec(derived?.stack_entry_details) ??
    asRec(derived?.stackEntryDetails) ??
    {}

  const fallbackIds: string[] = []
  if (Array.isArray(state.stack)) {
    for (const entry of state.stack) {
      const er = asRec(entry)
      if (!er) continue
      const id = er.id ?? er.object_id ?? er.objectId
      if (id != null) fallbackIds.push(String(id))
    }
  }

  type GroupIn = { representativeId: string; count: number; memberIds: string[] }
  const groups: GroupIn[] = []
  if (groupsRaw && groupsRaw.length > 0) {
    for (const g of groupsRaw) {
      const gr = asRec(g)
      if (!gr) continue
      const rep = String(gr.representative ?? gr.representative_id ?? gr.representativeId ?? '')
      if (!rep) continue
      const members = Array.isArray(gr.member_ids)
        ? gr.member_ids.map(String)
        : Array.isArray(gr.memberIds)
          ? gr.memberIds.map(String)
          : [rep]
      const count = typeof gr.count === 'number' ? gr.count : members.length || 1
      groups.push({ representativeId: rep, count, memberIds: members })
    }
  } else {
    for (const id of fallbackIds) {
      groups.push({ representativeId: id, count: 1, memberIds: [id] })
    }
  }

  return groups.map((g, index) => {
    const detail = asRec(detailsRaw[g.representativeId])
    const sourceName =
      (detail && typeof detail.source_name === 'string' && detail.source_name) ||
      (detail && typeof detail.sourceName === 'string' && detail.sourceName) ||
      objectNames[g.representativeId] ||
      ''
    const kindLabel =
      (detail && typeof detail.kind_label === 'string' && detail.kind_label) ||
      (detail && typeof detail.kindLabel === 'string' && detail.kindLabel) ||
      'Stack'
    const description =
      (detail && typeof detail.ability_description === 'string' && detail.ability_description) ||
      (detail && typeof detail.abilityDescription === 'string' && detail.abilityDescription) ||
      undefined
    const controller =
      detail && typeof detail.controller === 'number' ? detail.controller : undefined
    const targetsRaw =
      (detail && Array.isArray(detail.targets) && detail.targets) || []
    const targetLabels: string[] = []
    for (const t of targetsRaw) {
      const tr = asRec(t)
      if (tr && typeof tr.label === 'string') targetLabels.push(tr.label)
    }
    const obj = objects[g.representativeId]
    const chip = obj ? toView(obj, 'hand') : undefined
    const name = sourceName || chip?.card.name || `#${g.representativeId}`
    return {
      representativeId: g.representativeId,
      count: g.count,
      memberIds: g.memberIds,
      isTop: index === groups.length - 1,
      name,
      kindLabel,
      description: description || undefined,
      controller,
      targetLabels,
      chip,
    }
  })
}

export function buildPhaseBoardView(
  stateRaw: unknown,
  legalRaw: PhaseLegalActions | unknown,
): PhaseBoardView {
  const state = unwrapPhaseState(stateRaw)
  const { actions, actionsByObject, autoPass, manaPaymentShortcutActions, spellCosts } = normalizeLegalActions(legalRaw)

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
      stackGroups: [],
      actionsByObject,
      flatActions: actions,
      autoPass,
      manaPaymentShortcutActions,
      pinnedPoolUnits: [],
      objectNames: {},
      spellCosts,
    }
  }

  const objects = state.objects
  const phaseRaw = phaseString(state)
  const seats: PhaseSeatView[] = (state.players ?? [])
    .filter((p): p is RawPlayer => p != null && typeof p === 'object')
    .map((p, idx) => {
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

    const poison =
      typeof p.poison_counters === 'number'
        ? p.poison_counters
        : typeof p.poisonCounters === 'number'
          ? p.poisonCounters
          : 0

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
      poison,
      commanderDamage: [],
    }
  })

  const objectNames: Record<string, string> = {}
  for (const [k, obj] of Object.entries(objects)) {
    const name = typeof obj.name === 'string' ? obj.name : ''
    if (name) objectNames[String(k)] = name
    if (obj.id != null) objectNames[String(obj.id)] = name || objectNames[String(obj.id)] || ''
  }

  const cmdBySeat = parseCommanderDamageForSeats(
    state.derived,
    objectNames,
    seats.map((s) => s.id),
  )
  for (const seat of seats) {
    seat.commanderDamage = cmdBySeat.get(seat.id) ?? []
  }

  const stackGroups = parseStackGroups(state, objects, objectNames)

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
    stackCount: Array.isArray(state.stack) ? state.stack.length : stackGroups.reduce((n, g) => n + g.count, 0),
    stackGroups,
    actionsByObject,
    flatActions: actions,
    autoPass,
    manaPaymentShortcutActions,
    pinnedPoolUnits: parsePinnedPoolUnits(state),
    objectNames,
    spellCosts,
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
  for (const g of view.stackGroups) {
    const c = g.chip
    if (!c || c.faceDown) continue
    if (seen.has(c.card.name)) continue
    seen.add(c.card.name)
    stubs.push(c.card)
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

  const stackGroups = view.stackGroups.map((g) => {
    if (!g.chip || g.chip.faceDown) return g
    const h = byName.get(g.chip.card.name)
    if (!h) return g
    return {
      ...g,
      chip: {
        ...g.chip,
        card: {
          ...g.chip.card,
          ...h,
          id: g.chip.card.id,
          isCommander: g.chip.card.isCommander ?? h.isCommander,
          power: g.chip.card.power ?? h.power,
          toughness: g.chip.card.toughness ?? h.toughness,
        },
      },
    }
  })

  return {
    ...view,
    stackGroups,
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
  if (t === 'ActivateAbility') {
    const idx = d.ability_index ?? d.abilityIndex
    const src = d.source_id ?? d.sourceId
    return `ActivateAbility(#${idx ?? '?'}, source=${src ?? '?'})`
  }
  if (
    t === 'CastSpell' ||
    t === 'CastSpellForFree' ||
    t.startsWith('CastSpell')
  ) {
    const oid = d.object_id ?? d.objectId
    const targets = Array.isArray(d.targets) ? d.targets : []
    const tgt = targets.length ? ` →[${targets.join(',')}]` : ''
    return `${t}(obj=${oid ?? '?'}${tgt})`
  }
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
