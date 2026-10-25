/** Structured Phase boot progress for Engine UX. */

export type BootStage =
  | 'glue'
  | 'wasm'
  | 'init'
  | 'card-data'
  | 'load-db'
  | 'ready'
  | 'error'

export type BootProgress = {
  stage: BootStage
  message: string
  /** Overall 0..1 across the boot pipeline. */
  fraction: number
  /** Progress within the active stage when known. */
  stageFraction?: number
  bytesReceived?: number
  bytesTotal?: number | null
  fromCache?: boolean
}

export type BootProgressCb = (p: BootProgress) => void

/** Rough stage weights for overall fraction. */
const STAGE_SPAN: Record<Exclude<BootStage, 'error'>, { start: number; end: number }> = {
  glue: { start: 0, end: 0.04 },
  wasm: { start: 0.04, end: 0.36 },
  init: { start: 0.36, end: 0.42 },
  'card-data': { start: 0.42, end: 0.78 },
  'load-db': { start: 0.78, end: 0.98 },
  ready: { start: 1, end: 1 },
}

export const BOOT_STAGE_LABELS: { stage: BootStage; label: string }[] = [
  { stage: 'glue', label: 'Load glue' },
  { stage: 'wasm', label: 'Download WASM (~39 MB)' },
  { stage: 'init', label: 'Instantiate WASM' },
  { stage: 'card-data', label: 'Card data (~7 MB br → ~95 MB)' },
  { stage: 'load-db', label: 'Phase parse (sync)' },
  { stage: 'ready', label: 'Ready' },
]

export function stageOverall(stage: BootStage, stageFraction = 0): number {
  if (stage === 'error') return 0
  const span = STAGE_SPAN[stage]
  const t = Math.max(0, Math.min(1, stageFraction))
  return span.start + (span.end - span.start) * t
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Fetch a URL as ArrayBuffer with optional byte progress.
 * Works with Service Worker CacheFirst (cached responses still stream).
 */
export async function fetchBytesWithProgress(
  url: string,
  onBytes?: (received: number, total: number | null) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  const lenHeader = res.headers.get('content-length')
  const total = lenHeader ? Number(lenHeader) : null
  const usableTotal = total && Number.isFinite(total) && total > 0 ? total : null

  if (!res.body) {
    const buf = await res.arrayBuffer()
    onBytes?.(buf.byteLength, buf.byteLength)
    return buf
  }

  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) {
      chunks.push(value)
      received += value.byteLength
      onBytes?.(received, usableTotal)
    }
  }
  const out = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  onBytes?.(received, usableTotal ?? received)
  return out.buffer
}

export function bytesToUtf8(buf: ArrayBuffer): string {
  return new TextDecoder('utf-8').decode(buf)
}
