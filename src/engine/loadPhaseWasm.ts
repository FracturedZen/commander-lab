import { PHASE_CDN, PHASE_LOCAL, type PhaseLocalManifest } from './config'
import {
  fetchBytesWithProgress,
  formatBytes,
  stageOverall,
  type BootProgressCb,
} from './bootProgress'
import {
  bootWorkerUnavailable,
  compileWasmInWorker,
  isPhaseWasmCached,
} from './phaseBootWorker'
import { yieldToMain } from './bootYield'
import type { PhaseWasmModule } from './types'

let cached: PhaseWasmModule | null = null
let loadPromise: Promise<PhaseWasmModule> | null = null

export type ResolvedWasmSource = {
  url: string
  from: 'phase-local' | 'engine-local' | 'cdn'
  phaseCommit?: string
}

async function readPhaseLocalManifest(): Promise<PhaseLocalManifest | null> {
  const url = `${import.meta.env.BASE_URL}${PHASE_LOCAL.manifestPath}`
  try {
    const res = await fetch(url, { cache: 'no-cache' })
    if (!res.ok) return null
    return (await res.json()) as PhaseLocalManifest
  } catch {
    return null
  }
}

/** Prefer public/phase (fork build), then public/engine, then CDN pin. */
export async function resolveWasmUrl(): Promise<ResolvedWasmSource> {
  const base = import.meta.env.BASE_URL
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const candidates: Array<{ path: string; from: ResolvedWasmSource['from'] }> = [
    { path: `${base}${PHASE_LOCAL.wasmPath}`, from: 'phase-local' },
    { path: `${base}engine/engine_wasm_bg.wasm`, from: 'engine-local' },
  ]
  const manifest = await readPhaseLocalManifest()
  for (const c of candidates) {
    try {
      const probe = await fetch(c.path, { method: 'HEAD' })
      if (probe.ok) {
        return {
          url: origin ? new URL(c.path, origin).href : c.path,
          from: c.from,
          phaseCommit: manifest?.phaseCommit,
        }
      }
    } catch {
      /* try next */
    }
  }
  return { url: PHASE_CDN.wasmUrl, from: 'cdn', phaseCommit: manifest?.phaseCommit }
}

async function instantiateOnMain(
  mod: PhaseWasmModule,
  source: WebAssembly.Module | Response,
  onProgress?: BootProgressCb,
): Promise<void> {
  onProgress?.({
    stage: 'init',
    message: 'Instantiating WASM on main thread…',
    fraction: stageOverall('init', 0.2),
    stageFraction: 0.2,
  })
  await yieldToMain()
  await mod.default({ module_or_path: source })
  onProgress?.({
    stage: 'init',
    message: 'WASM ready',
    fraction: stageOverall('init', 1),
    stageFraction: 1,
  })
}

/**
 * Load Phase engine-wasm glue and instantiate WASM.
 * Prefers Worker download+compile (UI stays interactive); falls back to
 * main-thread fetch if Worker is blocked. Safe to call multiple times.
 */
export async function loadPhaseWasm(
  onProgress?: BootProgressCb,
): Promise<PhaseWasmModule> {
  if (cached) {
    onProgress?.({
      stage: 'init',
      message: 'WASM already loaded (memory)',
      fraction: stageOverall('init', 1),
      stageFraction: 1,
      fromCache: true,
    })
    return cached
  }
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    onProgress?.({
      stage: 'glue',
      message: 'Loading Phase WASM glue…',
      fraction: stageOverall('glue', 0),
      stageFraction: 0,
    })
    await yieldToMain()
    const mod = (await import('./phase/engine_wasm.js')) as unknown as PhaseWasmModule
    onProgress?.({
      stage: 'glue',
      message: 'Glue ready',
      fraction: stageOverall('glue', 1),
      stageFraction: 1,
    })

    const resolved = await resolveWasmUrl()
    const wasmUrl = resolved.url
    const sourceLabel =
      resolved.from === 'phase-local'
        ? 'local Phase fork'
        : resolved.from === 'engine-local'
          ? 'local engine/'
          : 'CDN'
    onProgress?.({
      stage: 'wasm',
      message: `WASM source: ${sourceLabel}${resolved.phaseCommit ? ` @ ${resolved.phaseCommit.slice(0, 7)}` : ''}…`,
      fraction: stageOverall('wasm', 0.02),
      stageFraction: 0.02,
    })
    const swCached = await isPhaseWasmCached(wasmUrl)
    if (swCached) {
      onProgress?.({
        stage: 'wasm',
        message: 'WASM in service-worker cache — compiling…',
        fraction: stageOverall('wasm', 0.85),
        stageFraction: 0.85,
        fromCache: true,
      })
    }

    // Prefer Worker compile path
    if (!bootWorkerUnavailable()) {
      try {
        const compiled = await compileWasmInWorker(wasmUrl, onProgress)
        await instantiateOnMain(mod, compiled, onProgress)
        cached = mod
        return mod
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        onProgress?.({
          stage: 'wasm',
          message: `Worker boot unavailable (${msg}) — main-thread fallback…`,
          fraction: stageOverall('wasm', 0),
          stageFraction: 0,
        })
        await yieldToMain()
      }
    }

    // Main-thread fallback: streamed fetch + instantiate
    onProgress?.({
      stage: 'wasm',
      message: swCached
        ? 'Reading cached WASM on main thread…'
        : 'Downloading Phase WASM (~39 MB)…',
      fraction: stageOverall('wasm', 0),
      stageFraction: 0,
      bytesReceived: 0,
      bytesTotal: null,
      fromCache: swCached,
    })

    const bytes = await fetchBytesWithProgress(wasmUrl, (received, total) => {
      const stageFraction = total && total > 0 ? Math.min(1, received / total) : 0
      onProgress?.({
        stage: 'wasm',
        message:
          total && total > 0
            ? `Downloading WASM… ${formatBytes(received)} / ${formatBytes(total)}`
            : `Downloading WASM… ${formatBytes(received)}`,
        fraction: stageOverall('wasm', stageFraction || (received > 0 ? 0.5 : 0)),
        stageFraction: stageFraction || undefined,
        bytesReceived: received,
        bytesTotal: total,
        fromCache: swCached,
      })
    })

    await instantiateOnMain(
      mod,
      new Response(bytes, { headers: { 'Content-Type': 'application/wasm' } }),
      onProgress,
    )
    cached = mod
    return mod
  })()

  try {
    return await loadPromise
  } catch (err) {
    loadPromise = null
    throw err
  }
}

export function getCachedPhaseWasm(): PhaseWasmModule | null {
  return cached
}
