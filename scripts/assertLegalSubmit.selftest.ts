/**
 * Client legal-submit gate — Engine must not invent Phase actions.
 * Run: npm run test:legal-submit
 */
import {
  assertActionSubmittable,
  isActionSubmittable,
  canonicalizeActionKey,
  collectLegalActionPool,
  actionInLegalPool,
  waitingAllowsActionType,
  waitingForType,
} from '../src/engine/assertLegalSubmit.ts'
import type { PhaseGameAction, PhaseLegalActions } from '../src/engine/types.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

const castAuto: PhaseGameAction = {
  type: 'CastSpell',
  data: { object_id: '42', targets: [], payment_mode: 'Auto' },
}
const castManual: PhaseGameAction = {
  type: 'CastSpell',
  data: { object_id: '42', targets: [], payment_mode: 'Manual' },
}
const castOther: PhaseGameAction = {
  type: 'CastSpell',
  data: { object_id: '99', targets: [], payment_mode: 'Auto' },
}
const pass: PhaseGameAction = { type: 'PassPriority' }
const concede: PhaseGameAction = {
  type: 'Concede',
  data: { player_id: 0 },
}
const fake: PhaseGameAction = {
  type: 'InventedCheat',
  data: { win: true },
}
const selectCards: PhaseGameAction = {
  type: 'SelectCards',
  data: { card_ids: ['1', '2'] },
}
const declareAtk: PhaseGameAction = {
  type: 'DeclareAttackers',
  data: { attackers: [], bands: [] },
}

const legal: PhaseLegalActions = {
  actions: [castAuto, pass],
  auto_pass: false,
  legalActionsByObject: {
    '42': [castAuto],
  },
  manaPaymentShortcutActions: [],
}

assert(
  canonicalizeActionKey(castAuto) === canonicalizeActionKey(castManual),
  'payment_mode must not affect cast key',
)
assert(
  canonicalizeActionKey(castAuto) !== canonicalizeActionKey(castOther),
  'different object_id must differ',
)

const pool = collectLegalActionPool(legal)
assert(actionInLegalPool(castManual, pool), 'Manual stamp of legal Auto cast allowed')
assert(actionInLegalPool(pass, pool), 'Pass in pool')
assert(!actionInLegalPool(fake, pool), 'invented action not in pool')

assert(waitingForType({ type: 'DiscardChoice', data: {} }) === 'DiscardChoice', 'waiting type')
assert(waitingForType('Priority') === 'Priority', 'string waiting')
assert(waitingAllowsActionType({ type: 'DiscardChoice' }, 'SelectCards'), 'discard → SelectCards')
assert(
  !waitingAllowsActionType({ type: 'DiscardChoice' }, 'CastSpell'),
  'discard does not allow CastSpell',
)
assert(
  waitingAllowsActionType({ type: 'DeclareAttackers' }, 'DeclareAttackers'),
  'attack waiting → DeclareAttackers',
)
assert(
  !waitingAllowsActionType({ type: 'Priority' }, 'SelectCards'),
  'Priority waiting does not open free SelectCards',
)
assert(
  !waitingAllowsActionType({ type: 'UnknownWeirdWaiting' }, 'SelectCards'),
  'unknown WaitingFor must not invent allowlist',
)

assertActionSubmittable(castManual, { legal })
assertActionSubmittable(pass, { legal })
assertActionSubmittable(concede, { legal })
assertActionSubmittable(selectCards, {
  legal: { actions: [], auto_pass: false },
  waitingRaw: { type: 'DiscardChoice', data: { cards: ['1', '2'], count: 1 } },
})
assertActionSubmittable(declareAtk, {
  legal: { actions: [], auto_pass: false },
  waitingRaw: { type: 'DeclareAttackers', data: {} },
})

assert(!isActionSubmittable(fake, { legal }), 'fake blocked')
assert(
  !isActionSubmittable(selectCards, { legal, waitingRaw: { type: 'Priority' } }),
  'SelectCards blocked under Priority',
)
assert(
  !isActionSubmittable(castOther, { legal }),
  'cast of non-legal object blocked',
)

let threw = false
try {
  assertActionSubmittable(fake, { legal })
} catch (e) {
  threw = true
  assert(
    e instanceof Error && e.message.includes('Illegal Engine submit blocked'),
    'error message names Illegal Engine submit blocked',
  )
}
assert(threw, 'fake must throw')

console.log('assertLegalSubmit.selftest: ok')
