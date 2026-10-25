export { ENGINE_MODE_DEFAULT, ENGINE_SETTINGS_KEY, PHASE_CDN, PHASE_AI_DIFFICULTY } from './config'
export type { EngineMode } from './config'
export { PhaseAdapter, getPhaseAdapter } from './PhaseAdapter'
export { loadPhaseWasm, getCachedPhaseWasm } from './loadPhaseWasm'
export { loadPhaseCardDataText } from './cardDataCache'
export {
  BOOT_STAGE_LABELS,
  formatBytes,
  stageOverall,
} from './bootProgress'
export type { BootProgress, BootStage, BootProgressCb } from './bootProgress'
export {
  deckToPhasePlayer,
  toPhaseDeckList,
  toPhaseMultiDeckList,
  sampleToPhasePlayer,
  emptyPhasePlayerDeck,
} from './deckMap'
export { runHeadlessGoldfish } from './headlessGoldfish'
export type { GoldfishResult } from './headlessGoldfish'
export type * from './types'
export { MockEngine } from './MockEngine'
export { goldfishStubDecks, goldfishStubDecksForCount, sanitizePhasePlayer } from './goldfishDecks'

export {
  buildPhaseBoardView,
  hydrateBoardArt,
  unwrapPhaseState,
  normalizeLegalActions,
  mapPhaseStepToLab,
  summarizeAction,
  pickPrimaryAction,
} from './phaseStateView'
export type { PhaseBoardView, PhaseObjectView, PhaseSeatView } from './phaseStateView'

export {
  parseWaitingFor,
  needsTargetingWizard,
  ensureAutoPayment,
  applyPaymentPref,
  stampPaymentMode,
  buildDeclareAttackersAction,
  buildDeclareNoneAttackers,
  buildDeclareBlockersAction,
  buildDeclareNoneBlockers,
  attackTargetsFor,
  needsAttackTargetPick,
  formatAttackTargetLabel,
  attackersReady,
  findMulliganActions,
  derivedEngineStops,
} from './engineInteraction'
export type { WaitingDetail, CastPaymentModeType } from './engineInteraction'

export {
  unwrapActionPayload,
  linesFromActionPayload,
  mergeLogLines,
  formatLogEntry,
  formatPhaseEvent,
  aggregateManaPool,
  manaCountsEntries,
  buildConcedeAction,
  MANA_PIP_GLYPH,
  MANA_PIP_CLASS,
} from './phaseGameLog'
export type { PhaseLogLine, PhaseGameLogEntry, PhaseManaCounts } from './phaseGameLog'
