/**
 * Phase ActionResult → compact game-log lines.
 * Prefers engine-authored `log_entries` (segments); falls back to summarizing `events`.
 */

export type PhaseLogSegment =
  | { type: 'Text'; value: string }
  | { type: 'CardName'; value: { name?: string; object_id?: number | string } }
  | { type: 'PlayerName'; value: { name?: string; player_id?: number } }
  | { type: 'Number'; value: number }
  | { type: 'Mana'; value: string }
  | { type: 'Zone'; value: string }
  | { type: 'Keyword'; value: string }
  | { type: string; value?: unknown }

export type PhaseGameLogEntry = {
  seq?: number
  turn?: number
  phase?: string
  category?: string
  segments?: PhaseLogSegment[]
  presentation?: {
    importance?: string
    tone?: string
    boundary?: string
    visibility?: string
  }
}

export type PhaseLogLine = {
  id: string
  seq: number
  turn: number
  phase: string
  category: string
  text: string
  /** Engine importance when present (Essential/Context/Detail/Diagnostic). */
  importance: string
}

export type PhaseManaCounts = {
  White: number
  Blue: number
  Black: number
  Red: number
  Green: number
  Colorless: number
  other: { color: string; count: number }[]
  total: number
}

const MANA_ORDER = ['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless'] as const

export const MANA_PIP_GLYPH: Record<string, string> = {
  White: 'W',
  Blue: 'U',
  Black: 'B',
  Red: 'R',
  Green: 'G',
  Colorless: 'C',
  Snow: 'S',
}

export const MANA_PIP_CLASS: Record<string, string> = {
  White: 'bg-amber-100 text-amber-950',
  Blue: 'bg-sky-500 text-white',
  Black: 'bg-slate-800 text-violet-200 ring-1 ring-violet-500/40',
  Red: 'bg-rose-600 text-white',
  Green: 'bg-emerald-600 text-white',
  Colorless: 'bg-slate-500 text-white',
  Snow: 'bg-cyan-200 text-cyan-950',
}

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

/** Pull ActionResult-shaped payload out of WASM envelopes. */
export function unwrapActionPayload(raw: unknown): {
  events: unknown[]
  logEntries: PhaseGameLogEntry[]
} {
  if (!raw || typeof raw !== 'object') return { events: [], logEntries: [] }
  const r = raw as Record<string, unknown>
  // Envelope: { status, result: ActionResult }
  const nested =
    r.status && r.result && typeof r.result === 'object'
      ? (r.result as Record<string, unknown>)
      : r
  const events = Array.isArray(nested.events)
    ? nested.events
    : Array.isArray(r.events)
      ? r.events
      : []
  const logRaw =
    (Array.isArray(nested.log_entries) && nested.log_entries) ||
    (Array.isArray(nested.logEntries) && nested.logEntries) ||
    (Array.isArray(r.log_entries) && r.log_entries) ||
    (Array.isArray(r.logEntries) && r.logEntries) ||
    []
  return {
    events,
    logEntries: logRaw.filter(
      (e): e is PhaseGameLogEntry => Boolean(e && typeof e === 'object'),
    ),
  }
}

export function formatLogSegment(seg: PhaseLogSegment): string {
  const t = seg.type
  const v = seg.value
  if (t === 'Text') return typeof v === 'string' ? v : String(v ?? '')
  if (t === 'Number') return String(v ?? '')
  if (t === 'Mana') return typeof v === 'string' ? `{${v}}` : String(v ?? '')
  if (t === 'Zone') return typeof v === 'string' ? v : String(v ?? '')
  if (t === 'Keyword') return typeof v === 'string' ? v : String(v ?? '')
  if (t === 'CardName') {
    const o = asRec(v)
    return String(o?.name ?? `Card#${o?.object_id ?? '?'}`)
  }
  if (t === 'PlayerName') {
    const o = asRec(v)
    if (typeof o?.name === 'string' && o.name) return o.name
    const id = o?.player_id
    if (id === 0) return 'You'
    if (typeof id === 'number') return `P${id}`
    return 'Player'
  }
  if (typeof v === 'string') return v
  if (v == null) return t
  return `${t}:${JSON.stringify(v)}`
}

export function formatLogEntry(entry: PhaseGameLogEntry): PhaseLogLine {
  const segs = Array.isArray(entry.segments) ? entry.segments : []
  const text = segs.map(formatLogSegment).join('').trim() || entry.category || '…'
  const importance = entry.presentation?.importance ?? 'Detail'
  return {
    id: `s${entry.seq ?? 0}-${entry.turn ?? 0}-${text.slice(0, 24)}`,
    seq: typeof entry.seq === 'number' ? entry.seq : 0,
    turn: typeof entry.turn === 'number' ? entry.turn : 0,
    phase: typeof entry.phase === 'string' ? entry.phase : '',
    category: typeof entry.category === 'string' ? entry.category : '',
    text,
    importance,
  }
}

/** Compact fallback when Phase omits log_entries (older builds / envelope quirks). */
export function formatPhaseEvent(ev: unknown): string | null {
  const r = asRec(ev)
  if (!r) return null
  const type = typeof r.type === 'string' ? r.type : null
  if (!type) return null
  const d = asRec(r.data) ?? {}
  switch (type) {
    case 'GameStarted':
      return 'Game started'
    case 'TurnStarted':
      return `Turn ${d.turn_number ?? d.turnNumber ?? '?'} · P${d.player_id ?? d.playerId ?? '?'}`
    case 'PhaseChanged':
      return `Phase → ${d.phase ?? '?'}`
    case 'PriorityPassed':
      return `Pass · P${d.player_id ?? d.playerId ?? '?'}`
    case 'SpellCast':
      return `Cast #${d.object_id ?? d.objectId ?? '?'} (P${d.controller ?? '?'})`
    case 'AbilityActivated':
      return `Activate #${d.source_id ?? d.sourceId ?? '?'} (P${d.player_id ?? d.playerId ?? '?'})`
    case 'LandPlayed':
      return `Land #${d.object_id ?? d.objectId ?? '?'} (P${d.player_id ?? d.playerId ?? '?'})`
    case 'LifeChanged': {
      const amt = typeof d.amount === 'number' ? d.amount : 0
      const sign = amt > 0 ? '+' : ''
      const total =
        typeof d.new_total === 'number'
          ? d.new_total
          : typeof d.newTotal === 'number'
            ? d.newTotal
            : null
      return `Life P${d.player_id ?? d.playerId ?? '?'} ${sign}${amt}${total != null ? ` → ${total}` : ''}`
    }
    case 'ManaAdded':
      return `Mana +${d.mana_type ?? d.manaType ?? '?'} (P${d.player_id ?? d.playerId ?? '?'})`
    case 'ManaPoolEmptied':
      return `Mana pool empty · P${d.player_id ?? d.playerId ?? '?'}`
    case 'CardsDrawn':
      return `Draw ${d.count ?? '?'} (P${d.player_id ?? d.playerId ?? '?'})`
    case 'CardDrawn':
      return `Draw (P${d.player_id ?? d.playerId ?? '?'})`
    case 'ZoneChanged':
      return `#${d.object_id ?? d.objectId ?? '?'} ${d.from ?? '∅'} → ${d.to ?? '?'}`
    case 'StackPushed':
      return `Stack +#${d.object_id ?? d.objectId ?? '?'}`
    case 'StackResolved':
      return `Resolve #${d.object_id ?? d.objectId ?? '?'}`
    case 'PlayerLost':
      return `P${d.player_id ?? d.playerId ?? '?'} loses`
    case 'MulliganStarted':
      return 'Mulligan'
    case 'PermanentTapped':
    case 'PermanentUntapped':
      return null // noise
    default:
      return type
  }
}

/**
 * Convert a submit/init payload into display lines (newest-last order from engine;
 * caller may reverse for UI).
 */
export function linesFromActionPayload(
  raw: unknown,
  opts: { includeDiagnostic?: boolean } = {},
): PhaseLogLine[] {
  const { events, logEntries } = unwrapActionPayload(raw)
  if (logEntries.length) {
    return logEntries
      .map(formatLogEntry)
      .filter((l) => opts.includeDiagnostic || l.importance !== 'Diagnostic')
  }
  const out: PhaseLogLine[] = []
  let i = 0
  for (const ev of events) {
    const text = formatPhaseEvent(ev)
    if (!text) continue
    const r = asRec(ev)
    out.push({
      id: `e${i}-${text.slice(0, 20)}`,
      seq: i++,
      turn: 0,
      phase: '',
      category: typeof r?.type === 'string' ? r.type : 'Event',
      text,
      importance: 'Context',
    })
  }
  return out
}

export function mergeLogLines(
  prev: PhaseLogLine[],
  next: PhaseLogLine[],
  max = 200,
): PhaseLogLine[] {
  if (!next.length) return prev
  const seen = new Set(prev.map((p) => `${p.seq}:${p.text}`))
  const merged = [...prev]
  for (const line of next) {
    const key = `${line.seq}:${line.text}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(line)
  }
  // Prefer chronological by seq when available
  merged.sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id))
  return merged.slice(-max)
}

export function aggregateManaPool(
  pips: { color: string }[] | undefined | null,
): PhaseManaCounts {
  const counts: Record<string, number> = {}
  for (const p of pips ?? []) {
    const c = p.color || 'Colorless'
    counts[c] = (counts[c] ?? 0) + 1
  }
  const other: { color: string; count: number }[] = []
  let total = 0
  for (const [color, count] of Object.entries(counts)) {
    total += count
    if (!(MANA_ORDER as readonly string[]).includes(color)) {
      other.push({ color, count })
    }
  }
  return {
    White: counts.White ?? 0,
    Blue: counts.Blue ?? 0,
    Black: counts.Black ?? 0,
    Red: counts.Red ?? 0,
    Green: counts.Green ?? 0,
    Colorless: counts.Colorless ?? 0,
    other,
    total,
  }
}

export function manaCountsEntries(counts: PhaseManaCounts): { color: string; count: number }[] {
  const rows: { color: string; count: number }[] = []
  for (const c of MANA_ORDER) {
    const n = counts[c]
    if (n > 0) rows.push({ color: c, count: n })
  }
  for (const o of counts.other) {
    if (o.count > 0) rows.push(o)
  }
  return rows
}

/** Legal Concede action for a seat (Phase GameAction). */
export function buildConcedeAction(playerId: number): { type: 'Concede'; data: { player_id: number } } {
  return { type: 'Concede', data: { player_id: playerId } }
}
