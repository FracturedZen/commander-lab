/**
 * Client-side gate: Engine may only submit Phase-authorized actions.
 * Phase WASM still rejects anything illegal; this blocks UI/AI fabrications
 * before they hit submit_action.
 */
import { normalizeLegalActions } from './phaseStateView'
import type { PhaseGameAction, PhaseLegalActions } from './types'

const CAST_OR_ACTIVATE = new Set([
  'CastSpell',
  'CastSpellForFree',
  'CastSpellAsSneak',
  'CastSpellAsWebSlinging',
  'CastSpellAsMiracle',
  'CastSpellAsMadness',
  'ActivateAbility',
])

/** WaitingFor.type → action types Engine may construct from that payload. */
const WAITING_RESPONSE_TYPES: Record<string, ReadonlySet<string>> = {
  DeclareAttackers: new Set(['DeclareAttackers']),
  DeclareBlockers: new Set(['DeclareBlockers']),
  AssignCombatDamage: new Set(['AssignCombatDamage']),
  AssignBlockerDamage: new Set(['AssignBlockerDamage']),
  MulliganDecision: new Set(['MulliganDecision']),
  ManaPayment: new Set([
    'TapLandForMana',
    'ActivateManaSource',
    'SpendPoolMana',
    'UnspendPoolMana',
    'CancelCast',
    'BackToManaPayment',
    'PassPriority',
    'ConfirmManaPayment',
    'CommitManaPayment',
  ]),
  ManaAbilityManaPayment: new Set([
    'TapLandForMana',
    'ActivateManaSource',
    'SpendPoolMana',
    'UnspendPoolMana',
    'CancelCast',
    'BackToManaPayment',
    'PassPriority',
    'ConfirmManaPayment',
    'CommitManaPayment',
  ]),
  ManaSourceSelection: new Set([
    'ActivateManaSource',
    'CancelCast',
    'BackToManaPayment',
  ]),
  PhyrexianPayment: new Set(['SubmitPhyrexianChoices', 'CancelCast']),
  ChooseXValue: new Set(['ChooseX', 'CancelCast']),
  AssistChoosePlayer: new Set(['ChooseAssistPlayer', 'CancelCast']),
  AssistPayment: new Set(['CommitAssistPayment', 'CancelCast']),
  DiscardChoice: new Set(['SelectCards']),
  DiscardToHandSize: new Set(['SelectCards']),
  WardDiscardChoice: new Set(['SelectCards']),
  ModeChoice: new Set(['SelectModes']),
  AbilityModeChoice: new Set(['SelectModes']),
  EffectZoneChoice: new Set(['SelectCards']),
  ScryChoice: new Set(['SelectCards']),
  SurveilChoice: new Set(['SelectCards']),
  RippleBottomOrder: new Set(['SelectCards']),
  RevealUntilBottomOrder: new Set(['SelectCards']),
  DigRestSplitChoice: new Set(['SelectCards']),
  ArrangePlanarDeckTopChoice: new Set(['SelectCards']),
  SearchChoice: new Set(['SelectCards']),
  SearchPartitionChoice: new Set(['SelectCards']),
  DigChoice: new Set(['SelectCards']),
  RevealChoice: new Set(['SelectCards']),
  ChooseFromZoneChoice: new Set(['SelectCards']),
  OrderTriggers: new Set(['OrderTriggers']),
  ReplacementChoice: new Set([
    'ChooseReplacement',
    'ChooseReplacementAndRemember',
  ]),
  PayAmountChoice: new Set(['SubmitPayAmount']),
  CrewVehicle: new Set(['CrewVehicle']),
  SaddleMount: new Set(['SaddleMount']),
  EquipTarget: new Set(['Equip']),
  StationTarget: new Set(['ActivateStation']),
  OptionalCostChoice: new Set(['DecideOptionalCost']),
  UnlessPayment: new Set(['PayUnlessCost']),
  UnlessPaymentChooseCost: new Set(['ChooseUnlessCostBranch']),
  OptionalEffectChoice: new Set(['DecideOptionalEffect']),
  OpponentMayChoice: new Set(['DecideOptionalEffect']),
  TributeChoice: new Set(['DecideOptionalEffect']),
  TargetSelection: new Set(['ChooseTarget']),
  TriggerTargetSelection: new Set(['ChooseTarget']),
  MultiTargetSelection: new Set(['SelectCards', 'SelectTargets']),
  PairChoice: new Set(['ChoosePair']),
  CopyTargetChoice: new Set(['ChooseTarget']),
  DamageSourceChoice: new Set(['ChooseDamageSource']),
}

/** Stable JSON key; cast/activate ignore payment_mode (UI stamps Auto/Manual/Sac-safe). */
export function canonicalizeActionKey(action: PhaseGameAction): string {
  const type = action.type
  let data: unknown = action.data
  if (CAST_OR_ACTIVATE.has(type) && data && typeof data === 'object') {
    const d = { ...(data as Record<string, unknown>) }
    delete d.payment_mode
    delete d.paymentMode
    data = d
  }
  return JSON.stringify({ type, data: data ?? null })
}

export function collectLegalActionPool(
  legal: PhaseLegalActions | unknown,
): PhaseGameAction[] {
  const {
    actions,
    actionsByObject,
    manaPaymentShortcutActions,
  } = normalizeLegalActions(legal)
  const pool: PhaseGameAction[] = [
    ...actions,
    ...manaPaymentShortcutActions,
  ]
  for (const list of Object.values(actionsByObject)) {
    pool.push(...list)
  }
  return pool
}

export function actionInLegalPool(
  action: PhaseGameAction,
  pool: PhaseGameAction[],
): boolean {
  const key = canonicalizeActionKey(action)
  return pool.some((a) => canonicalizeActionKey(a) === key)
}

export function waitingForType(waitingRaw: unknown): string | null {
  if (!waitingRaw) return null
  if (typeof waitingRaw === 'string') return waitingRaw
  if (typeof waitingRaw === 'object') {
    const t = (waitingRaw as { type?: unknown }).type
    return typeof t === 'string' ? t : null
  }
  return null
}

export function waitingAllowsActionType(
  waitingRaw: unknown,
  actionType: string,
): boolean {
  const wt = waitingForType(waitingRaw)
  if (!wt || wt === 'Priority') return false
  const allowed = WAITING_RESPONSE_TYPES[wt]
  if (!allowed) {
    // Unknown WaitingFor: only Pass/Cancel-style that also appear in legal pool
    // are accepted via pool match — do not invent a free-form allowlist.
    return false
  }
  return allowed.has(actionType)
}

export type AssertSubmittableOpts = {
  legal: PhaseLegalActions | unknown
  waitingRaw?: unknown
  /** Concede leaves the table; always allowed for the human seat. Default true. */
  allowConcede?: boolean
}

/**
 * Throws if `action` is not Phase-legal for the current view.
 * Legal = exact (payment_mode-normalized) match in get_legal_actions* pool,
 * OR a WaitingFor response type authorized for the current waiting_for,
 * OR Concede (meta leave).
 */
export function assertActionSubmittable(
  action: PhaseGameAction,
  opts: AssertSubmittableOpts,
): void {
  if (!action || typeof action.type !== 'string' || !action.type) {
    throw new Error('Illegal Engine submit blocked: missing action type')
  }
  if (opts.allowConcede !== false && action.type === 'Concede') return

  const pool = collectLegalActionPool(opts.legal)
  if (actionInLegalPool(action, pool)) return

  if (waitingAllowsActionType(opts.waitingRaw, action.type)) return

  const wt = waitingForType(opts.waitingRaw)
  throw new Error(
    `Illegal Engine submit blocked: ${action.type} is not Phase-legal` +
      (wt ? ` (waiting_for=${wt})` : ' (not in legal actions)'),
  )
}

/** Pure check for tests / UI. */
export function isActionSubmittable(
  action: PhaseGameAction,
  opts: AssertSubmittableOpts,
): boolean {
  try {
    assertActionSubmittable(action, opts)
    return true
  } catch {
    return false
  }
}
