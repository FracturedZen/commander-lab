import { PHASE_CDN } from './config'
import {
  fetchBytesWithProgress,
  formatBytes,
  stageOverall,
  type BootProgressCb,
} from './bootProgress'
import type { PhaseWasmModule } from './types'

let cached: PhaseWasmModule | null = null
let loadPromise: Promise<PhaseWasmModule> | null = null

/**
 * Load Phase engine-wasm glue (code-split) and instantiate WASM (CDN or local).
 * Safe to call multiple times — returns the same module.
 * On failure the promise is cleared so Retry can call again.
 */
export async function loadPhaseWasm(
  onProgress?: BootProgressCb,
): Promise<PhaseWasmModule> {
  if (cached) {
    onProgress?.({
      stage: 'init',
      message: 'WASM already loaded',
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
    const mod = (await import('./phase/engine_wasm.js')) as unknown as PhaseWasmModule
    onProgress?.({
      stage: 'glue',
      message: 'Glue ready',
      fraction: stageOverall('glue', 1),
      stageFraction: 1,
    })

    const localWasm = `${import.meta.env.BASE_URL}engine/engine_wasm_bg.wasm`
    let wasmUrl: string = PHASE_CDN.wasmUrl
    try {
      const probe = await fetch(localWasm, { method: 'HEAD' })
      if (probe.ok) wasmUrl = new URL(localWasm, window.location.origin).href
    } catch {
      /* use CDN */
    }

    onProgress?.({
      stage: 'wasm',
      message: 'Downloading Phase WASM (~39 MB)…',
      fraction: stageOverall('wasm', 0),
      stageFraction: 0,
      bytesReceived: 0,
      bytesTotal: null,
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
      })
    })

    onProgress?.({
      stage: 'init',
      message: 'Instantiating WASM…',
      fraction: stageOverall('init', 0),
      stageFraction: 0,
      bytesReceived: bytes.byteLength,
      bytesTotal: bytes.byteLength,
    })
    await mod.default({
      module_or_path: new Response(bytes, {
        headers: { 'Content-Type': 'application/wasm' },
      }),
    })
    onProgress?.({
      stage: 'init',
      message: 'WASM ready',
      fraction: stageOverall('init', 1),
      stageFraction: 1,
    })
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
