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
