import {
  buildPhaseBoardView,
  mapPhaseStepToLab,
  normalizeLegalActions,
  unwrapPhaseState,
} from '../src/engine/phaseStateView.ts'
import { toPhaseDeckList, deckToPhasePlayer } from '../src/engine/deckMap'
import {
  unwrapActionPayload,
  linesFromActionPayload,
  mergeLogLines,
  formatLogEntry,
  formatPhaseEvent,
  aggregateManaPool,
  manaCountsEntries,
  buildConcedeAction,
} from '../src/engine/phaseGameLog.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const wrapped = {
  state: {
    turn_number: 3,
    active_player: 0,
    priority_player: 0,
    phase: 'PreCombatMain',
    players: [
      { id: 0, life: 40, library: [10, 11], hand: [1, 2], graveyard: [] },
      { id: 1, life: 39, library: [20], hand: [3], graveyard: [] },
    ],
    objects: {
      '1': {
        id: 1,
        name: 'Mountain',
        zone: 'Hand',
        owner: 0,
        controller: 0,
        tapped: false,
        card_types: { supertypes: ['Basic'], core_types: ['Land'], subtypes: ['Mountain'] },
      },
      '2': {
        id: 2,
        name: 'Sol Ring',
        zone: 'Hand',
        owner: 0,
        controller: 0,
        tapped: false,
        card_types: { supertypes: [], core_types: ['Artifact'], subtypes: [] },
      },
      '3': {
        id: 3,
        name: 'Island',
        zone: 'Hand',
        owner: 1,
        controller: 1,
        tapped: false,
        card_types: { supertypes: ['Basic'], core_types: ['Land'], subtypes: ['Island'] },
      },
      '4': {
        id: 4,
        name: 'Krenko, Mob Boss',
        zone: 'Command',
        owner: 0,
        controller: 0,
        tapped: false,
        is_commander: true,
        power: 3,
        toughness: 3,
        card_types: {
          supertypes: ['Legendary'],
          core_types: ['Creature'],
          subtypes: ['Goblin'],
        },
      },
      '5': {
        id: 5,
        name: 'Mountain',
        zone: 'Battlefield',
        owner: 0,
        controller: 0,
        tapped: true,
        card_types: { supertypes: ['Basic'], core_types: ['Land'], subtypes: ['Mountain'] },
      },
    },
    battlefield: [5],
    exile: [],
    command_zone: [4],
    stack: [],
  },
  derived: {},
}

assert(unwrapPhaseState(wrapped)?.turn_number === 3, 'unwrap turn')
assert(mapPhaseStepToLab('DeclareAttackers') === 'combat_attackers', 'map phase')

const legal = {
  actions: [
    { type: 'PlayLand', data: { object_id: 1 } },
    { type: 'PassPriority' },
  ],
  autoPassRecommended: false,
  legalActionsByObject: {
    '1': [{ type: 'PlayLand', data: { object_id: 1 }, interactionActionId: 'x' }],
  },
}

const norm = normalizeLegalActions(legal)
assert(norm.actions.length === 2, 'actions')
assert(norm.actionsByObject['1']?.[0]?.type === 'PlayLand', 'by object strip')
assert(!('interactionActionId' in (norm.actionsByObject['1']![0] as object)), 'stripped id')

const view = buildPhaseBoardView(wrapped, legal)
assert(view.ok, 'view ok')
assert(view.seats[0]!.hand.length === 2, 'hand')
assert(view.seats[0]!.lands.length === 1, 'lands')
assert(view.seats[0]!.command[0]!.card.name === 'Krenko, Mob Boss', 'commander')
assert(view.seats[0]!.command[0]!.card.isCommander === true, 'isCommander')
assert(view.phase === 'main1', 'lab phase')
assert(view.actionsByObject['1']?.length === 1, 'glow map')

console.log('phaseStateView.selftest OK')

// --- engineInteraction helpers ---
import {
  parseWaitingFor,
  needsTargetingWizard,
  nextSlotTargets,
  matchCastVariant,
  ensureAutoPayment,
  applyPaymentPref,
  buildDeclareAttackersAction,
  findMulliganActions,
  buildSelectCards,
  buildSelectModes,
  buildActivateManaSource,
  buildChooseX,
  buildSubmitPhyrexianChoices,
  buildChooseAssistPlayer,
  buildCommitAssistPayment,
  buildSpendPoolMana,
  buildUnspendPoolMana,
  buildOrderTriggers,
  buildChooseReplacement,
  buildChooseReplacementAndRemember,
  buildSubmitPayAmount,
  buildAssignCombatDamage,
  buildAssignBlockerDamage,
  defaultCombatDamageSplit,
  defaultBlockerDamageSplit,
  combatDamageReady,
  blockerDamageReady,
  defaultPhyrexianChoices,
  phyrexianChoicesPayload,
  chooseXInRange,
  assistPaymentInRange,
  derivedEngineStops,
  discardReady,
  manaTapObjectIds,
  libraryBipartReady,
  reorderCardsReady,
  cardPickReady,
  payAmountInRange,
  isReplacementOrderMode,
  buildCrewVehicle,
  buildSaddleMount,
  buildEquip,
  buildActivateStation,
  buildDecideOptionalCost,
  buildPayUnlessCost,
  buildChooseUnlessCostBranch,
  buildDecideOptionalEffect,
  buildChooseTarget,
  buildChoosePair,
  buildChooseDamageSource,
  crewLikeReady,
  multiTargetReady,
  selectedContributionTotal,
  summarizeCostLabel,
  preferActivateAbility,
  countRespondableActions,
  hasBoardResponses,
  formatSpellCostLabel,
  isActivateAbility,
  isCastOrActivate,
} from '../src/engine/engineInteraction.ts'

const waitAtk = parseWaitingFor({
  type: 'DeclareAttackers',
  data: {
    player: 0,
    valid_attacker_ids: [10, 11],
    valid_attack_targets: [{ type: 'Player', data: 1 }],
  },
})
assert(waitAtk?.kind === 'DeclareAttackers', 'parse attackers')
if (waitAtk?.kind === 'DeclareAttackers') {
  assert(waitAtk.validAttackerIds.join(',') === '10,11', 'attacker ids')
  const act = buildDeclareAttackersAction(['10'], waitAtk)
  assert(act?.type === 'DeclareAttackers', 'build attack')
  const data = act!.data as { attacks: unknown[] }
  assert(Array.isArray(data.attacks) && data.attacks.length === 1, 'one attack')
}

const waitBlk = parseWaitingFor({
  type: 'DeclareBlockers',
  data: {
    player: 0,
    valid_blocker_ids: [20],
    valid_block_targets: { '20': [10] },
  },
})
assert(waitBlk?.kind === 'DeclareBlockers', 'parse blockers')

const casts = [
  { type: 'CastSpell', data: { object_id: 2, card_id: 1, targets: [5] } },
  { type: 'CastSpell', data: { object_id: 2, card_id: 1, targets: [6] } },
]
assert(needsTargetingWizard(casts), 'needs wizard')
assert(nextSlotTargets(casts, []).sort().join(',') === '5,6', 'next slots')
assert(matchCastVariant(casts, ['5'])?.data && true, 'match 5')
const paid = ensureAutoPayment(casts[0]!)
assert(
  (paid.data as { payment_mode?: { type?: string } }).payment_mode?.type === 'Auto',
  'auto pay stamped',
)

const mull = findMulliganActions([
  { type: 'MulliganDecision', data: { choice: { type: 'Keep' } } },
  { type: 'MulliganDecision', data: { choice: { type: 'Mulligan' } } },
])
assert(!!mull.keep && !!mull.mulligan, 'mulligan actions')

// waitingRaw passthrough
const withWait = {
  state: {
    ...wrapped.state,
    waiting_for: {
      type: 'DeclareAttackers',
      data: { player: 0, valid_attacker_ids: [5], valid_attack_targets: [{ type: 'Player', data: 1 }] },
    },
  },
}
const viewWait = buildPhaseBoardView(withWait, { actions: [] })
assert(viewWait.waitingFor === 'DeclareAttackers', 'waitingFor type')
assert(viewWait.waitingRaw && typeof viewWait.waitingRaw === 'object', 'waitingRaw present')

// --- v0.6.3 mana / discard / mode WaitingFor ---
const waitMana = parseWaitingFor({
  type: 'ManaPayment',
  data: { player: 0 },
})
assert(waitMana?.kind === 'ManaPayment', 'parse ManaPayment')

const waitSac = parseWaitingFor({
  type: 'ManaSourceSelection',
  data: {
    player: 0,
    options: [{ source: { object_id: 9, incarnation: 1 }, mana_type: 'Green', penalty: { type: 'Sacrifice' }, taps_for_mana: [], restrictions: [] }],
  },
})
assert(waitSac?.kind === 'ManaSourceSelection', 'parse ManaSourceSelection')
if (waitSac?.kind === 'ManaSourceSelection') {
  assert(waitSac.options.length === 1, 'sac options')
  const act = buildActivateManaSource(waitSac.options[0])
  assert(act.type === 'ActivateManaSource', 'activate mana source')
}

const waitDisc = parseWaitingFor({
  type: 'DiscardChoice',
  data: { player: 0, count: 2, cards: [1, 2, 3], source_id: 9, effect_kind: 'x' },
})
assert(waitDisc?.kind === 'Discard', 'parse DiscardChoice')
if (waitDisc?.kind === 'Discard') {
  assert(waitDisc.cards.join(',') === '1,2,3', 'discard cards')
  assert(discardReady(waitDisc, ['1', '2']), 'discard ready exact')
  assert(!discardReady(waitDisc, ['1']), 'discard not ready')
  const sel = buildSelectCards(['1', '2'])
  assert(sel.type === 'SelectCards', 'SelectCards')
}

const waitMode = parseWaitingFor({
  type: 'ModeChoice',
  data: {
    player: 0,
    modal: {
      min_choices: 1,
      max_choices: 1,
      mode_count: 2,
      mode_descriptions: ['Destroy target', 'Draw a card'],
      allow_repeat_modes: false,
    },
  },
})
assert(waitMode?.kind === 'ModeChoice', 'parse ModeChoice')
if (waitMode?.kind === 'ModeChoice') {
  assert(waitMode.modeDescriptions.length === 2, 'mode descs')
  assert(buildSelectModes([0]).type === 'SelectModes', 'SelectModes')
}

const manual = applyPaymentPref(
  { type: 'CastSpell', data: { object_id: 1, card_id: 2, targets: [] } },
  'Manual',
)
assert(
  (manual.data as { payment_mode?: { type?: string } }).payment_mode?.type === 'Manual',
  'manual stamp',
)

const stops = derivedEngineStops(waitMana, 'main1')
assert(stops.has('main1'), 'rail stop main1 for mana')

const tapMap = manaTapObjectIds({
  '3': [{ type: 'TapLandForMana', data: { selection: { source: { object_id: 3 } } } }],
  '4': [{ type: 'PlayLand', data: { object_id: 4 } }],
})
assert(tapMap.has('3') && !tapMap.has('4'), 'mana tap glow map')

const withShortcuts = buildPhaseBoardView(wrapped, {
  actions: [],
  mana_payment_shortcut_actions: [
    { type: 'TapLandForMana', data: { selection: { source: { object_id: 3, incarnation: 0 } } } },
  ],
})
assert(withShortcuts.manaPaymentShortcutActions.length === 1, 'shortcuts on view')

// --- v0.6.4 Phyrexian / ChooseX / Assist / pool pin ---
const waitPhy = parseWaitingFor({
  type: 'PhyrexianPayment',
  data: {
    player: 0,
    spell_object: 12,
    shards: [
      { shard_index: 0, color: 'Black', options: { type: 'ManaOrLife' } },
      { shard_index: 1, color: 'Black', options: { type: 'LifeOnly' } },
    ],
  },
})
assert(waitPhy?.kind === 'PhyrexianPayment', 'parse PhyrexianPayment')
if (waitPhy?.kind === 'PhyrexianPayment') {
  assert(waitPhy.shards.length === 2, 'shards')
  const picks = defaultPhyrexianChoices(waitPhy.shards)
  assert(picks.get(1) === 'life', 'LifeOnly default')
  picks.set(0, 'life')
  const payload = phyrexianChoicesPayload(waitPhy.shards, picks)
  assert(payload[0]?.type === 'PayLife' && payload[1]?.type === 'PayLife', 'phy choices')
  assert(buildSubmitPhyrexianChoices(payload).type === 'SubmitPhyrexianChoices', 'submit phy')
}

const waitX = parseWaitingFor({
  type: 'ChooseXValue',
  data: { min: 0, max: 5, x_cost_previews: [[0, {}], [2, {}]] },
})
assert(waitX?.kind === 'ChooseXValue', 'parse ChooseXValue')
if (waitX?.kind === 'ChooseXValue') {
  assert(waitX.min === 0 && waitX.max === 5, 'x range')
  assert(chooseXInRange(waitX, 3), 'x in range')
  assert(!chooseXInRange(waitX, 9), 'x out of range')
  assert(buildChooseX(3).type === 'ChooseX', 'ChooseX action')
}

const waitAssistP = parseWaitingFor({
  type: 'AssistChoosePlayer',
  data: { candidates: [1], max_generic: 2 },
})
assert(waitAssistP?.kind === 'AssistChoosePlayer', 'parse AssistChoosePlayer')
if (waitAssistP?.kind === 'AssistChoosePlayer') {
  assert(waitAssistP.candidates[0] === 1, 'assist candidates')
  assert(buildChooseAssistPlayer(null).type === 'ChooseAssistPlayer', 'decline assist')
}

const waitAssistPay = parseWaitingFor({
  type: 'AssistPayment',
  data: { max_generic: 3, caster: 0, chosen: 1 },
})
assert(waitAssistPay?.kind === 'AssistPayment', 'parse AssistPayment')
if (waitAssistPay?.kind === 'AssistPayment') {
  assert(assistPaymentInRange(waitAssistPay, 2), 'assist pay ok')
  assert(!assistPaymentInRange(waitAssistPay, 9), 'assist pay bad')
  assert(buildCommitAssistPayment(2).type === 'CommitAssistPayment', 'commit assist')
}

assert(buildSpendPoolMana(7).type === 'SpendPoolMana', 'SpendPoolMana')
assert(buildUnspendPoolMana(7).type === 'UnspendPoolMana', 'UnspendPoolMana')

const withPool = {
  state: {
    ...wrapped.state,
    players: [
      {
        ...wrapped.state.players[0],
        mana_pool: {
          mana: [
            { pip_id: 101, color: 'Red', source_id: 5, restrictions: [] },
            { pip_id: 102, color: 'Red', source_id: 5, restrictions: ['ConvokePayment'] },
          ],
        },
      },
      wrapped.state.players[1],
    ],
    pending_cast: { pinned_pool_units: [101] },
  },
}
const viewPool = buildPhaseBoardView(withPool, { actions: [] })
assert(viewPool.seats[0]!.manaPool.length === 2, 'mana pool pips')
assert(viewPool.pinnedPoolUnits.includes(101), 'pinned units')

const stopsPhy = derivedEngineStops(waitPhy, 'main1')
assert(stopsPhy.has('main1'), 'rail stop phyrexian')

// --- v0.6.5 Search / Scry / OrderTriggers / Replacement / PayAmount ---
const waitScry = parseWaitingFor({
  type: 'ScryChoice',
  data: { player: 0, cards: [21, 22, 23] },
})
assert(waitScry?.kind === 'LibraryBipart', 'parse ScryChoice')
if (waitScry?.kind === 'LibraryBipart') {
  assert(waitScry.cards.length === 3, 'scry cards')
  assert(libraryBipartReady(waitScry, ['21', '22']), 'scry keep subset')
  assert(!libraryBipartReady(waitScry, ['21', '99']), 'scry reject foreign')
  assert(buildSelectCards(['21']).type === 'SelectCards', 'scry submit')
}

const waitSurveil = parseWaitingFor({
  type: 'SurveilChoice',
  data: { player: 0, cards: [30] },
})
assert(waitSurveil?.kind === 'LibraryBipart' && waitSurveil.type === 'SurveilChoice', 'surveil')

const waitRipple = parseWaitingFor({
  type: 'RippleBottomOrder',
  data: { player: 0, cards: [1, 2] },
})
assert(waitRipple?.kind === 'ReorderCards', 'parse RippleBottomOrder')
if (waitRipple?.kind === 'ReorderCards') {
  assert(reorderCardsReady(waitRipple, ['2', '1']), 'ripple perm')
  assert(!reorderCardsReady(waitRipple, ['1']), 'ripple incomplete')
}

const waitDigRest = parseWaitingFor({
  type: 'DigRestSplitChoice',
  data: { player: 0, cards: [4, 5, 6], top_count: 1, scope: { type: 'OrderOnly' } },
})
assert(waitDigRest?.kind === 'ReorderCards', 'parse DigRestSplit')
if (waitDigRest?.kind === 'ReorderCards') {
  assert(waitDigRest.topCount === 1 && waitDigRest.orderOnly, 'dig rest fields')
  assert(reorderCardsReady(waitDigRest, ['4', '5', '6']), 'dig rest order-only keep top')
  assert(!reorderCardsReady(waitDigRest, ['5', '4', '6']), 'dig rest cannot cross')
}

const waitArrange = parseWaitingFor({
  type: 'ArrangePlanarDeckTopChoice',
  data: { player: 0, cards: [7, 8, 9], keep_on_top: 2 },
})
assert(waitArrange?.kind === 'ReorderCards', 'parse ArrangePlanar')
if (waitArrange?.kind === 'ReorderCards') {
  assert(waitArrange.exactKeepCount === 2, 'planar keep')
  assert(reorderCardsReady(waitArrange, ['7', '9']), 'planar ready')
  assert(!reorderCardsReady(waitArrange, ['7']), 'planar short')
}

const waitSearch = parseWaitingFor({
  type: 'SearchChoice',
  data: {
    player: 0,
    cards: [40, 41, 42],
    count: 2,
    up_to: true,
    allows_partial_find: true,
    ordering_hint: { type: 'OrderedToLibraryTop' },
  },
})
assert(waitSearch?.kind === 'CardPick', 'parse SearchChoice')
if (waitSearch?.kind === 'CardPick') {
  assert(waitSearch.upTo && waitSearch.ordered && waitSearch.count === 2, 'search flags')
  assert(cardPickReady(waitSearch, ['40']), 'search up-to')
  assert(!cardPickReady(waitSearch, ['40', '41', '42']), 'search over')
}

const waitReveal = parseWaitingFor({
  type: 'RevealChoice',
  data: { player: 0, cards: [50], count: 1, optional: true },
})
assert(waitReveal?.kind === 'CardPick', 'parse RevealChoice')
if (waitReveal?.kind === 'CardPick') {
  assert(cardPickReady(waitReveal, []), 'reveal decline')
}

const waitDig = parseWaitingFor({
  type: 'DigChoice',
  data: { player: 0, selectable_cards: [60, 61], keep_count: 1, up_to: false },
})
assert(waitDig?.kind === 'CardPick' && waitDig.count === 1, 'parse DigChoice')

const waitTrig = parseWaitingFor({
  type: 'OrderTriggers',
  data: {
    player: 0,
    triggers: [
      { source_id: 1, source_name: 'A', description: 'draw' },
      { source_id: 2, source_name: 'B', description: 'damage' },
    ],
  },
})
assert(waitTrig?.kind === 'OrderTriggers', 'parse OrderTriggers')
if (waitTrig?.kind === 'OrderTriggers') {
  assert(waitTrig.triggers.length === 2, 'triggers')
  assert(buildOrderTriggers([1, 0]).type === 'OrderTriggers', 'OrderTriggers action')
}

const waitRep = parseWaitingFor({
  type: 'ReplacementChoice',
  data: {
    player: 0,
    candidate_count: 2,
    candidates: [
      { source_id: 8, source_name: 'Torpor Orb', description: 'skip ETB' },
      { source_id: 9, source_name: 'Doubling Season', description: 'double' },
    ],
    kind: { type: 'Order' },
    last_applied_decides: false,
    remember_identity: { type: 'SomeTag' },
  },
})
assert(waitRep?.kind === 'ReplacementChoice', 'parse ReplacementChoice')
if (waitRep?.kind === 'ReplacementChoice') {
  assert(isReplacementOrderMode(waitRep), 'replacement order mode')
  assert(waitRep.canRemember, 'remember flag')
  assert(buildChooseReplacement(0).type === 'ChooseReplacement', 'ChooseReplacement')
  assert(
    buildChooseReplacementAndRemember({ type: 'Order', data: { order: [1, 0] } }).type ===
      'ChooseReplacementAndRemember',
    'ChooseReplacementAndRemember',
  )
}

const waitPay = parseWaitingFor({
  type: 'PayAmountChoice',
  data: {
    player: 0,
    min: 1,
    max: 4,
    source_id: 99,
    resource: { type: 'Energy' },
  },
})
assert(waitPay?.kind === 'PayAmountChoice', 'parse PayAmountChoice')
if (waitPay?.kind === 'PayAmountChoice') {
  assert(waitPay.resourceType === 'Energy', 'resource')
  assert(payAmountInRange(waitPay, 2), 'pay ok')
  assert(!payAmountInRange(waitPay, 0), 'pay low')
  assert(buildSubmitPayAmount(3).type === 'SubmitPayAmount', 'SubmitPayAmount')
}

const stopsScry = derivedEngineStops(waitScry, 'main1')
assert(stopsScry.has('main1'), 'rail stop scry')
const stopsSearch = derivedEngineStops(waitSearch, 'main1')
assert(stopsSearch.has('main1'), 'rail stop search')

assert(viewPool.objectNames != null, 'objectNames present')

// --- v0.6.6 stack / combat damage / poison / commander damage ---
const waitAcd = parseWaitingFor({
  type: 'AssignCombatDamage',
  data: {
    player: 0,
    attacker_id: 70,
    total_damage: 5,
    blockers: [
      { blocker_id: 71, lethal_minimum: 2 },
      { blocker_id: 72, lethal_minimum: 1 },
    ],
    assignment_modes: ['Normal', 'AsThoughUnblocked'],
    trample: 'Standard',
    defending_player: 1,
    attack_target: { type: 'Player', data: 1 },
  },
})
assert(waitAcd?.kind === 'AssignCombatDamage', 'parse AssignCombatDamage')
if (waitAcd?.kind === 'AssignCombatDamage') {
  assert(waitAcd.attackerId === '70' && waitAcd.totalDamage === 5, 'acd fields')
  assert(waitAcd.blockers.length === 2 && waitAcd.trample === 'Standard', 'acd blockers/tramp')
  assert(waitAcd.assignmentModes.includes('AsThoughUnblocked'), 'acd modes')
  const split = defaultCombatDamageSplit(waitAcd)
  assert(split.amounts['71'] === 2 && split.amounts['72'] === 1, 'acd lethal default')
  assert(split.trampleDamage === 2, 'acd tramp rest')
  assert(combatDamageReady(waitAcd, 'Normal', split.amounts, split.trampleDamage, 0), 'acd ready')
  const act = buildAssignCombatDamage('Normal', split.amounts, split.trampleDamage, 0)
  assert(act.type === 'AssignCombatDamage', 'AssignCombatDamage action')
  const asThough = buildAssignCombatDamage('AsThoughUnblocked', {}, 0, 0)
  assert(
    (asThough.data as { mode?: string }).mode === 'AsThoughUnblocked',
    'as though mode',
  )
}
const stopsAcd = derivedEngineStops(waitAcd, 'combat_damage')
assert(stopsAcd.has('combat'), 'rail stop AssignCombatDamage')

const waitAbd = parseWaitingFor({
  type: 'AssignBlockerDamage',
  data: { player: 0, blocker_id: 80, total_damage: 3, attackers: [81, 82] },
})
assert(waitAbd?.kind === 'AssignBlockerDamage', 'parse AssignBlockerDamage')
if (waitAbd?.kind === 'AssignBlockerDamage') {
  const amounts = defaultBlockerDamageSplit(waitAbd)
  assert(amounts['81'] === 3 && amounts['82'] === 0, 'abd dump first')
  assert(blockerDamageReady(waitAbd, amounts), 'abd ready')
  assert(buildAssignBlockerDamage(amounts).type === 'AssignBlockerDamage', 'abd action')
}

const withStack = {
  state: {
    ...wrapped.state,
    stack: [{ id: 100 }, { id: 101 }],
    players: [
      { id: 0, life: 40, library: [10], hand: [], graveyard: [], poison_counters: 2 },
      { id: 1, life: 36, library: [20], hand: [], graveyard: [], poison_counters: 0 },
    ],
    objects: {
      ...wrapped.state.objects,
      '100': {
        id: 100,
        name: 'Lightning Bolt',
        zone: 'Stack',
        owner: 0,
        controller: 0,
        tapped: false,
        card_types: { supertypes: [], core_types: ['Instant'], subtypes: [] },
      },
      '101': {
        id: 101,
        name: 'Counterspell',
        zone: 'Stack',
        owner: 1,
        controller: 1,
        tapped: false,
        card_types: { supertypes: [], core_types: ['Instant'], subtypes: [] },
      },
    },
  },
  derived: {
    stack_display_groups: [
      { representative: 100, count: 1, member_ids: [100] },
      { representative: 101, count: 1, member_ids: [101] },
    ],
    stack_entry_details: {
      '100': {
        source_name: 'Lightning Bolt',
        kind_label: 'Instant',
        controller: 0,
        targets: [{ label: 'Player 1', target: { type: 'Player', data: 1 } }],
      },
      '101': {
        source_name: 'Counterspell',
        kind_label: 'Instant',
        controller: 1,
        targets: [{ label: 'Lightning Bolt', target: { type: 'StackObject', data: 100 } }],
      },
    },
    commander_damage_by_attacker: {
      '0': [{ victim: 1, commander: 4, damage: 6 }],
    },
  },
}
const viewStack = buildPhaseBoardView(withStack, { actions: [] })
assert(viewStack.ok, 'stack view ok')
assert(viewStack.stackGroups.length === 2, 'stack groups')
assert(viewStack.stackGroups[1]!.isTop, 'top is last')
assert(viewStack.stackGroups[0]!.name === 'Lightning Bolt', 'stack name')
assert(viewStack.seats[0]!.poison === 2, 'poison')
assert(viewStack.seats[1]!.commanderDamage.length === 1, 'cmd dmg')
assert(viewStack.seats[1]!.commanderDamage[0]!.damage === 6, 'cmd dmg amt')
assert(viewStack.stackCount === 2, 'stack count')


// --- v0.6.7 crew/equip/optional/unless/target-step/object-pick ---
const waitCrew = parseWaitingFor({
  type: 'CrewVehicle',
  data: {
    player: 0,
    vehicle_id: 200,
    crew_power: 3,
    eligible_creatures: [201, 202, 203],
    contributions: [1, 2, 3],
  },
})
assert(waitCrew?.kind === 'CrewLike' && waitCrew.type === 'CrewVehicle', 'parse CrewVehicle')
if (waitCrew?.kind === 'CrewLike') {
  assert(waitCrew.need === 3 && waitCrew.eligible.length === 3, 'crew fields')
  assert(!crewLikeReady(waitCrew, ['201']), 'crew under')
  assert(crewLikeReady(waitCrew, ['202', '201']), 'crew meet')
  assert(selectedContributionTotal(waitCrew.eligible, waitCrew.contributions, ['203']) === 3, 'contrib')
  assert(buildCrewVehicle('200', ['202', '201']).type === 'CrewVehicle', 'CrewVehicle action')
}

const waitSaddle = parseWaitingFor({
  type: 'SaddleMount',
  data: { player: 0, mount_id: 210, saddle_power: 2, eligible_creatures: [211], contributions: [2] },
})
assert(waitSaddle?.kind === 'CrewLike' && waitSaddle.type === 'SaddleMount', 'parse Saddle')
assert(buildSaddleMount('210', ['211']).type === 'SaddleMount', 'SaddleMount action')

const waitEquip = parseWaitingFor({
  type: 'EquipTarget',
  data: { player: 0, equipment_id: 220, valid_targets: [221, 222] },
})
assert(waitEquip?.kind === 'AttachPick' && waitEquip.type === 'EquipTarget', 'parse Equip')
assert(buildEquip('220', '221').type === 'Equip', 'Equip action')

const waitStation = parseWaitingFor({
  type: 'StationTarget',
  data: { player: 0, spacecraft_id: 230, eligible_creatures: [231] },
})
assert(waitStation?.kind === 'AttachPick' && waitStation.type === 'StationTarget', 'parse Station')
assert(buildActivateStation('230', '231').type === 'ActivateStation', 'Station action')

const waitOptCost = parseWaitingFor({
  type: 'OptionalCostChoice',
  data: {
    player: 0,
    cost: { type: 'Optional', data: { cost: { type: 'PayLife', amount: { type: 'Literal', data: 2 } } } },
    times_kicked: 1,
    origin: 'Kicker',
  },
})
assert(waitOptCost?.kind === 'OptionalCostChoice', 'parse OptionalCost')
if (waitOptCost?.kind === 'OptionalCostChoice') {
  assert(waitOptCost.origin === 'Kicker' && waitOptCost.timesKicked === 1, 'opt cost meta')
  assert(buildDecideOptionalCost(true).type === 'DecideOptionalCost', 'DecideOptionalCost')
}

const waitUnless = parseWaitingFor({
  type: 'UnlessPayment',
  data: {
    player: 0,
    cost: { type: 'Mana', cost: { generic: 3 } },
    effect_description: 'counter target spell',
  },
})
assert(waitUnless?.kind === 'UnlessPayment', 'parse UnlessPayment')
assert(buildPayUnlessCost(false).type === 'PayUnlessCost', 'PayUnlessCost')

const waitUnlessChoose = parseWaitingFor({
  type: 'UnlessPaymentChooseCost',
  data: {
    player: 0,
    costs: [{ type: 'Sacrifice' }, { type: 'Discard' }],
    effect_description: 'lose life',
  },
})
assert(waitUnlessChoose?.kind === 'UnlessPaymentChooseCost', 'parse UnlessChoose')
if (waitUnlessChoose?.kind === 'UnlessPaymentChooseCost') {
  assert(waitUnlessChoose.costLabels.length === 2, 'unless branches')
  const pay = buildChooseUnlessCostBranch({ type: 'Pay', data: { index: 1 } })
  assert(pay.type === 'ChooseUnlessCostBranch', 'ChooseUnlessCostBranch')
  assert(buildChooseUnlessCostBranch({ type: 'Decline' }).type === 'ChooseUnlessCostBranch', 'decline branch')
}

const waitMay = parseWaitingFor({
  type: 'OptionalEffectChoice',
  data: { player: 0, source_id: 240, description: 'draw a card' },
})
assert(waitMay?.kind === 'OptionalEffect', 'parse OptionalEffect')
assert(buildDecideOptionalEffect(true).type === 'DecideOptionalEffect', 'DecideOptionalEffect')

const waitTribute = parseWaitingFor({
  type: 'TributeChoice',
  data: { player: 0, source_id: 241, count: 2 },
})
assert(waitTribute?.kind === 'OptionalEffect' && waitTribute.type === 'TributeChoice', 'parse Tribute')

const waitTgt = parseWaitingFor({
  type: 'TargetSelection',
  data: {
    player: 0,
    target_slots: [{ legal_targets: [], optional: true, effect_kind: 'Damage' }],
    selection: {
      current_slot: 0,
      current_legal_targets: [{ Object: 250 }, { Player: 1 }],
    },
  },
})
assert(waitTgt?.kind === 'TargetStep', 'parse TargetSelection')
if (waitTgt?.kind === 'TargetStep') {
  assert(waitTgt.optional && waitTgt.legal.length === 2, 'target step legal')
  assert(waitTgt.legal.some((t) => t.kind === 'Player' && t.id === 1), 'player target')
  assert(buildChooseTarget(waitTgt.legal[0]!).type === 'ChooseTarget', 'ChooseTarget')
  assert(buildChooseTarget(null).type === 'ChooseTarget', 'ChooseTarget skip')
}

const waitTrigTgt = parseWaitingFor({
  type: 'TriggerTargetSelection',
  data: {
    player: 0,
    source_id: 260,
    description: 'destroy target',
    target_slots: [{ legal_targets: [], optional: false, effect_kind: 'Destroy' }],
    selection: { current_slot: 0, current_legal_targets: [{ Object: 261 }] },
  },
})
assert(waitTrigTgt?.kind === 'TargetStep' && waitTrigTgt.type === 'TriggerTargetSelection', 'parse TriggerTarget')

const waitMulti = parseWaitingFor({
  type: 'MultiTargetSelection',
  data: { player: 0, legal_targets: [270, 271, 272], min_targets: 0, max_targets: 2 },
})
assert(waitMulti?.kind === 'MultiTargetSelection', 'parse MultiTarget')
if (waitMulti?.kind === 'MultiTargetSelection') {
  assert(multiTargetReady(waitMulti, []), 'multi empty ok')
  assert(multiTargetReady(waitMulti, ['270', '271']), 'multi two')
  assert(!multiTargetReady(waitMulti, ['270', '271', '272']), 'multi over')
}

const waitPair = parseWaitingFor({
  type: 'PairChoice',
  data: { player: 0, source_id: 280, choices: [281, 282] },
})
assert(waitPair?.kind === 'ObjectPick' && waitPair.allowSkip, 'parse Pair')
assert(buildChoosePair('281').type === 'ChoosePair', 'ChoosePair')
assert(buildChoosePair(null).type === 'ChoosePair', 'ChoosePair skip')

const waitCopy = parseWaitingFor({
  type: 'CopyTargetChoice',
  data: { player: 0, source_id: 290, valid_targets: [291] },
})
assert(waitCopy?.kind === 'ObjectPick' && waitCopy.type === 'CopyTargetChoice', 'parse Copy')

const waitDmg = parseWaitingFor({
  type: 'DamageSourceChoice',
  data: { player: 0, options: [300, 301] },
})
assert(waitDmg?.kind === 'ObjectPick' && !waitDmg.allowSkip, 'parse DamageSource')
assert(buildChooseDamageSource('300').type === 'ChooseDamageSource', 'ChooseDamageSource')

assert(derivedEngineStops(waitCrew, 'main1').has('main1'), 'rail crew')
assert(derivedEngineStops(waitTgt, 'main1').has('main1'), 'rail target step')
assert(typeof summarizeCostLabel({ type: 'Tap' }) === 'string', 'cost label')



// --- v0.6.8 activate / priority / spellCosts / command cast ---
const actOnly = [
  { type: 'ActivateAbility', data: { source_id: 50, ability_index: 0 } },
  { type: 'TapLandForMana', data: { selection: { source: { object_id: 50 } } } },
]
const pref = preferActivateAbility(actOnly)
assert(pref && pref !== 'picker' && pref.type === 'ActivateAbility', 'prefer single activate over mana')
assert(
  (pref as { data?: { payment_mode?: { type?: string } } }).data?.payment_mode?.type === 'Auto',
  'activate auto pay',
)
assert(preferActivateAbility([
  { type: 'ActivateAbility', data: { source_id: 50, ability_index: 0 } },
  { type: 'ActivateAbility', data: { source_id: 50, ability_index: 1 } },
]) === 'picker', 'multi activate picker')
assert(
  preferActivateAbility([
    { type: 'CastSpell', data: { object_id: 9, targets: [] } },
    { type: 'ActivateAbility', data: { source_id: 50, ability_index: 0 } },
  ]) === null,
  'cast beats activate pref',
)
assert(isActivateAbility(actOnly[0]!), 'isActivate')
assert(isCastOrActivate(actOnly[0]!), 'castOrActivate')
assert(countRespondableActions([
  { type: 'PassPriority' },
  { type: 'ActivateAbility', data: { source_id: 1, ability_index: 0 } },
]) === 1, 'respondable')
assert(
  hasBoardResponses({
    '50': [{ type: 'ActivateAbility', data: { source_id: 50, ability_index: 0 } }],
  }),
  'board responses',
)
assert(
  formatSpellCostLabel({ type: 'Cost', shards: ['Green', 'Green'], generic: 2 }) === '{2}{G}{G}',
  'cost label',
)
assert(formatSpellCostLabel({ type: 'NoCost' }) === '{0}', 'nocost')

const legalWithCosts = {
  actions: [
    { type: 'PassPriority' },
    {
      type: 'CastSpell',
      data: { object_id: 3, card_id: 1, targets: [], payment_mode: { type: 'Auto' } },
    },
    { type: 'ActivateAbility', data: { source_id: 2, ability_index: 0 } },
  ],
  autoPassRecommended: false,
  spellCosts: {
    '3': { type: 'Cost', shards: ['Red'], generic: 4 },
  },
  legal_actions_by_object: {
    '2': [
      {
        type: 'ActivateAbility',
        data: { source_id: 2, ability_index: 0 },
        interactionActionId: 'x',
      },
    ],
  },
}
const normCosts = normalizeLegalActions(legalWithCosts)
assert(normCosts.spellCosts['3'] != null, 'spellCosts plumbed')
assert(normCosts.actionsByObject['2']?.some((a) => a.type === 'ActivateAbility'), 'activate by object')
assert(normCosts.actionsByObject['3']?.some((a) => a.type === 'CastSpell'), 'cast merged from flat')
const viewCosts = buildPhaseBoardView(wrapped, legalWithCosts)
assert(viewCosts.spellCosts['3'] != null, 'view spellCosts')
assert(formatSpellCostLabel(viewCosts.spellCosts['3']) === '{4}{R}', 'cmd tax-ish cost')


console.log('phaseStateView.selftest + engineInteraction: ok')

// --- v0.6.9 deck map (IndexedDB → Phase) ---
{
  const fakeDeck = {
    id: 'd1',
    name: 'Test',
    commander: { id: 'c', name: 'Krenko, Mob Boss', quantity: 1 },
    cards: [
      { id: 'a', name: 'Mountain', quantity: 50 },
      { id: 'b', name: 'Goblin Motivator', quantity: 1 },
    ],
    createdAt: 1,
    updatedAt: 1,
  }
  const fakeAi = {
    ...fakeDeck,
    id: 'd2',
    name: 'AI',
    commander: { id: 'c2', name: 'Aesi, Tyrant of Gyre Strait', quantity: 1 },
    cards: [{ id: 'i', name: 'Island', quantity: 50 }],
  }
  const mapped = deckToPhasePlayer(fakeDeck as never)
  assert(mapped.commander[0] === 'Krenko, Mob Boss', 'commander name')
  assert(mapped.main_deck.filter((n) => n === 'Mountain').length === 50, 'qty expand')
  assert(!mapped.main_deck.includes('Krenko, Mob Boss'), 'cmd not in main')
  const list = toPhaseDeckList(fakeDeck as never, fakeAi as never)
  assert(list.player.commander[0] === 'Krenko, Mob Boss', 'human seat')
  assert(list.opponent.commander[0] === 'Aesi, Tyrant of Gyre Strait', 'ai seat')
  assert(list.ai_decks?.[0]?.commander[0] === 'Aesi, Tyrant of Gyre Strait', 'ai_decks')
}
console.log('phaseStateView.selftest: ok (incl. v0.6.9 deckMap)')

// --- v0.7.0 game log / mana / concede helpers ---
{
  const entry = {
    seq: 12,
    turn: 2,
    phase: 'PreCombatMain',
    category: 'Cast',
    segments: [
      { type: 'PlayerName', value: { player_id: 0 } },
      { type: 'Text', value: ' casts ' },
      { type: 'CardName', value: { name: 'Sol Ring', object_id: 7 } },
      { type: 'Text', value: ' for ' },
      { type: 'Mana', value: '1' },
    ],
    presentation: { importance: 'Essential' },
  }
  const line = formatLogEntry(entry)
  assert(line.text.includes('Sol Ring') && line.text.includes('You'), 'formatLogEntry text')
  assert(line.importance === 'Essential', 'importance')

  const payload = {
    status: 'ok',
    result: {
      events: [{ type: 'LandPlayed', data: { object_id: 9, player_id: 0 } }],
      log_entries: [entry],
    },
  }
  const un = unwrapActionPayload(payload)
  assert(un.logEntries.length === 1, 'unwrap log_entries')
  assert(un.events.length === 1, 'unwrap events')
  const fromLog = linesFromActionPayload(payload)
  assert(fromLog.length === 1 && fromLog[0].text.includes('Sol Ring'), 'prefer log_entries')

  const evOnly = linesFromActionPayload({
    events: [
      { type: 'LifeChanged', data: { player_id: 1, amount: -3, new_total: 37 } },
      { type: 'PermanentTapped', data: { object_id: 1 } },
    ],
  })
  assert(evOnly.length === 1 && evOnly[0].text.includes('Life'), 'event fallback skips tap noise')
  assert(formatPhaseEvent({ type: 'GameStarted' }) === 'Game started', 'GameStarted')

  const merged = mergeLogLines(fromLog, [
    { id: 'x', seq: 13, turn: 2, phase: '', category: '', text: 'Pass', importance: 'Detail' },
    fromLog[0],
  ])
  assert(merged.length === 2, 'merge dedupe + append')

  const counts = aggregateManaPool([
    { color: 'Red' },
    { color: 'Red' },
    { color: 'Blue' },
    { color: 'Snow' },
  ])
  assert(counts.Red === 2 && counts.Blue === 1 && counts.total === 4, 'aggregateManaPool')
  const rows = manaCountsEntries(counts)
  assert(rows[0].color === 'Blue' && rows.some((r) => r.color === 'Snow'), 'manaCountsEntries order')

  const concede = buildConcedeAction(0)
  assert(concede.type === 'Concede' && concede.data.player_id === 0, 'buildConcedeAction')
}
console.log('phaseStateView.selftest: ok (incl. v0.7.0 gameLog/mana/concede)')
