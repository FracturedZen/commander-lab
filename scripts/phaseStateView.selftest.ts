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
  defaultPhyrexianChoices,
  phyrexianChoicesPayload,
  chooseXInRange,
  assistPaymentInRange,
  derivedEngineStops,
  discardReady,
  manaTapObjectIds,
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

console.log('phaseStateView.selftest + engineInteraction: ok')
