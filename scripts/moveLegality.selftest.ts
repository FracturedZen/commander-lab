/**
 * Pure matrix self-test for checkZoneMove. Run: npx tsx src/lib/rules/moveLegality.selftest.ts
 */
import {
  checkZoneMove,
  legalDestinations,
  type PendingAction,
  type PendingActionType,
} from '../src/lib/rules/moveLegality'
import type { ZoneName } from '../src/types/game'
import type { Phase } from '../src/lib/rules/turnMachine'

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

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`)
  process.exit(1)
}
console.log('\nAll moveLegality matrix assertions passed.')
