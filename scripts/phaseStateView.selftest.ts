import {
  buildPhaseBoardView,
  mapPhaseStepToLab,
  normalizeLegalActions,
  unwrapPhaseState,
} from '../src/engine/phaseStateView.ts'

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

console.log('phaseStateView.selftest + engineInteraction: ok')
