/**
 * Pure matrix + mana/land-drop self-test.
 * Run: npm run test:rules
 */
import {
  checkZoneMove,
  legalDestinations,
  type PendingAction,
  type PendingActionType,
} from '../src/lib/rules/moveLegality'
import {
  canPayWithLands,
  checkPlayOrCast,
  parseManaCost,
} from '../src/lib/rules/mana'
import type { ZoneName } from '../src/types/game'
import type { Phase } from '../src/lib/rules/turnMachine'
import type { CardInstance, CardRef } from '../src/types/card'

const ZONES: ZoneName[] = [
  'hand',
  'library',
  'battlefield',
  'graveyard',
  'exile',
  'command',
]
const PHASE: Phase = 'main1'
const PID = 'p1'

function base(extra: Partial<Parameters<typeof checkZoneMove>[0]> = {}) {
  return checkZoneMove({
    from: 'hand',
    to: 'battlefield',
    rulesStrict: true,
    phase: PHASE,
    playerId: PID,
    pendingActions: [],
    ...extra,
  })
}

function pending(
  type: PendingActionType,
  toZone?: ZoneName,
): PendingAction[] {
  return [
    {
      id: 'a1',
      type,
      count: 1,
      playerId: PID,
      toZone,
      label: type,
    },
  ]
}

function land(name: string, tapped = false): CardInstance {
  const produces =
    name === 'Island'
      ? 'U'
      : name === 'Mountain'
        ? 'R'
        : name === 'Swamp'
          ? 'B'
          : name === 'Forest'
            ? 'G'
            : 'W'
  const card: CardRef = {
    id: name.toLowerCase(),
    name,
    typeLine: `Basic Land — ${name}`,
    colorIdentity: produces === 'C' ? [] : [produces],
  }
  return { instanceId: crypto.randomUUID(), card, tapped }
}

function creature(name: string, manaCost: string, cmc: number): CardRef {
  return {
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    manaCost,
    cmc,
    typeLine: 'Creature — Test',
  }
}

let failed = 0
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failed++
    console.error('FAIL:', msg)
  }
}

function assertAllowed(
  from: ZoneName,
  to: ZoneName,
  opts: Partial<Parameters<typeof checkZoneMove>[0]> = {},
  expect = true,
) {
  const r = base({ from, to, ...opts })
  assert(
    r.allowed === expect,
    `${from}→${to} expected allowed=${expect}, got ${r.allowed}${r.reason ? ` (${r.reason})` : ''}`,
  )
}

console.log('=== empty pending, main1, non-commander ===')
const alwaysOk: [ZoneName, ZoneName][] = [
  ['hand', 'battlefield'],
  ['command', 'battlefield'],
  ['battlefield', 'graveyard'],
  ['battlefield', 'exile'],
]
for (const from of ZONES) {
  for (const to of ZONES) {
    if (from === to) continue
    const expect = alwaysOk.some(([f, t]) => f === from && t === to)
    assertAllowed(from, to, { isCommander: false }, expect)
  }
}

console.log('=== commander extras ===')
assertAllowed('battlefield', 'command', { isCommander: true }, true)
assertAllowed('graveyard', 'command', { isCommander: true }, true)
assertAllowed('battlefield', 'command', { isCommander: false }, false)

console.log('=== sandbox flag must NOT unlock cheats ===')
assertAllowed('library', 'graveyard', { rulesStrict: false }, false)
assertAllowed('library', 'battlefield', { rulesStrict: false }, false)
assertAllowed('library', 'hand', { rulesStrict: false }, false)
assertAllowed('graveyard', 'hand', { rulesStrict: false }, false)
assertAllowed('graveyard', 'battlefield', { rulesStrict: false }, false)
assertAllowed('exile', 'hand', { rulesStrict: false }, false)
assertAllowed('hand', 'graveyard', { rulesStrict: false }, false)

console.log('=== pending unlocks ===')
assertAllowed('library', 'hand', { pendingActions: pending('draw') }, true)
assertAllowed('library', 'hand', { pendingActions: pending('tutor') }, true)
assertAllowed('library', 'graveyard', { pendingActions: pending('mill') }, true)
assertAllowed(
  'library',
  'exile',
  { pendingActions: pending('exileFromLibrary') },
  true,
)
assertAllowed(
  'library',
  'battlefield',
  { pendingActions: pending('putFromLibrary') },
  true,
)
assertAllowed('hand', 'graveyard', { pendingActions: pending('discard') }, true)
assertAllowed(
  'graveyard',
  'hand',
  { pendingActions: pending('returnFromGy') },
  true,
)
assertAllowed(
  'graveyard',
  'battlefield',
  { pendingActions: pending('putFromGy') },
  true,
)
assertAllowed(
  'exile',
  'hand',
  { pendingActions: pending('returnFromExile') },
  true,
)

console.log('=== phase gates ===')
assertAllowed('hand', 'battlefield', { phase: 'draw' }, false)
assertAllowed('command', 'battlefield', { phase: 'draw' }, false)
assertAllowed('hand', 'battlefield', { phase: 'main2' }, true)

console.log('=== legalDestinations library empty pending ===')
const libDest = legalDestinations({
  from: 'library',
  rulesStrict: false,
  phase: PHASE,
  playerId: PID,
  pendingActions: [],
})
assert(libDest.length === 0, `library dests should be [] got ${libDest.map((d) => d.zone)}`)

const millDest = legalDestinations({
  from: 'library',
  rulesStrict: false,
  phase: PHASE,
  playerId: PID,
  pendingActions: pending('mill'),
})
assert(
  millDest.some((d) => d.zone === 'graveyard') && millDest.length === 1,
  `mill should unlock only GY, got ${millDest.map((d) => d.zone)}`,
)

console.log('=== mana parse ===')
const parsed = parseManaCost('{2}{U}{U}')
assert(parsed.generic === 2 && parsed.U === 2 && parsed.total === 4, 'parse {2}{U}{U}')

console.log('=== land drop once ===')
const islandCard: CardRef = {
  id: 'island',
  name: 'Island',
  typeLine: 'Basic Land — Island',
}
const landOk = checkPlayOrCast({
  card: islandCard,
  from: 'hand',
  landsPlayedThisTurn: 0,
  battlefield: [],
})
assert(landOk.allowed && landOk.countsAsLandDrop, 'first land allowed')
const landDenied = checkPlayOrCast({
  card: islandCard,
  from: 'hand',
  landsPlayedThisTurn: 1,
  battlefield: [],
})
assert(
  !landDenied.allowed &&
    (landDenied.reason ?? '').includes('Already played a land'),
  'second land denied',
)

console.log('=== creature needs mana ===')
const bolt = creature('Goblin Guide', '{R}', 1)
const noMana = checkPlayOrCast({
  card: bolt,
  from: 'hand',
  landsPlayedThisTurn: 0,
  battlefield: [],
})
assert(
  !noMana.allowed && (noMana.reason ?? '').includes('Not enough mana'),
  'creature without lands denied',
)
const withMountain = checkPlayOrCast({
  card: bolt,
  from: 'hand',
  landsPlayedThisTurn: 0,
  battlefield: [land('Mountain')],
})
assert(
  withMountain.allowed && withMountain.tapIds?.length === 1,
  'creature with untapped Mountain allowed',
)

console.log('=== canPayWithLands colored + generic ===')
const pay = canPayWithLands('{1}{U}', [land('Island'), land('Plains')])
assert(pay.ok && pay.tapIds.length === 2, 'pay {1}{U} with Island+Plains')
const failPay = canPayWithLands('{U}{U}', [land('Island'), land('Mountain')])
assert(!failPay.ok, 'cannot pay {U}{U} with Island+Mountain')

console.log('=== commander tax ===')
const cmd: CardRef = {
  id: 'krenko',
  name: 'Krenko, Mob Boss',
  manaCost: '{2}{R}{R}',
  cmc: 4,
  typeLine: 'Legendary Creature — Goblin',
  isCommander: true,
}
const taxPay = checkPlayOrCast({
  card: cmd,
  from: 'command',
  landsPlayedThisTurn: 0,
  battlefield: [
    land('Mountain'),
    land('Mountain'),
    land('Mountain'),
    land('Mountain'),
  ],
  commanderCastCount: 0,
})
assert(taxPay.allowed, 'commander cast with 4 mountains')
const taxFail = checkPlayOrCast({
  card: cmd,
  from: 'command',
  landsPlayedThisTurn: 0,
  battlefield: [
    land('Mountain'),
    land('Mountain'),
    land('Mountain'),
    land('Mountain'),
  ],
  commanderCastCount: 1, // +2 tax → need 6
})
assert(
  !taxFail.allowed && (taxFail.reason ?? '').includes('Not enough mana'),
  'commander tax blocks underpay',
)

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll moveLegality + mana assertions passed.')
