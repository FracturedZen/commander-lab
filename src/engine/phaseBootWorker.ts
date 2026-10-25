import { PHASE_CDN } from './config'
import { stageOverall, type BootProgressCb } from './bootProgress'

type WorkerProgressMsg = {
  id: number
  type: 'progress'
  stage: 'wasm' | 'init'
  message: string
  bytesReceived?: number
  bytesTotal?: number | null
  fraction?: number
}

type WorkerResultMsg =
  | { id: number; ok: true; type: 'compileWasm'; module: WebAssembly.Module }
  | { id: number; ok: true; type: 'ping' }
  | { id: number; ok: false; error: string }

let nextId = 1
let workerSingleton: Worker | null = null
let workerFailed = false

function workerUrl(): string {
  const base = import.meta.env.BASE_URL || '/'
  return new URL('engine/phase-worker.js', window.location.origin + base).href
}

function getWorker(): Worker {
  if (workerSingleton) return workerSingleton
  const w = new Worker(workerUrl())
  workerSingleton = w
  return w
}

/** True when a prior Worker attempt failed hard (don't keep retrying every boot). */
export function bootWorkerUnavailable(): boolean {
  return workerFailed
}

/**
 * Download + WebAssembly.compile in a dedicated Worker.
 * Posts BootProgress to the UI; returns a compiled Module for main-thread init.
 */
export async function compileWasmInWorker(
  wasmUrl: string,
  onProgress?: BootProgressCb,
): Promise<WebAssembly.Module> {
  if (workerFailed) throw new Error('Boot worker previously unavailable')
  if (typeof Worker === 'undefined') {
    workerFailed = true
    throw new Error('Worker not supported')
  }

  let worker: Worker
  try {
    worker = getWorker()
  } catch (err) {
    workerFailed = true
    throw err instanceof Error ? err : new Error(String(err))
  }

  const id = nextId++
  return new Promise<WebAssembly.Module>((resolve, reject) => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data as (WorkerProgressMsg | WorkerResultMsg) | null
      if (!data || data.id !== id) return

      if ('type' in data && data.type === 'progress') {
        const prog = data as WorkerProgressMsg
        const stage = prog.stage === 'init' ? 'init' : 'wasm'
        const stageFraction = prog.fraction ?? 0
        onProgress?.({
          stage,
          message: prog.message,
          fraction: stageOverall(stage, stageFraction),
          stageFraction,
          bytesReceived: prog.bytesReceived,
          bytesTotal: prog.bytesTotal ?? null,
        })
        return
      }

      cleanup()
      if ('ok' in data && data.ok === true && 'type' in data && data.type === 'compileWasm') {
        resolve((data as Extract<WorkerResultMsg, { ok: true; type: 'compileWasm' }>).module)
        return
      }
      if ('ok' in data && data.ok === false) {
        reject(new Error(data.error || 'Worker compile failed'))
        return
      }
    }

    const onError = (err: ErrorEvent) => {
      cleanup()
      workerFailed = true
      try {
        worker.terminate()
      } catch {
        /* ignore */
      }
      workerSingleton = null
      reject(new Error(err.message || 'Boot worker error'))
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage as EventListener)
      worker.removeEventListener('error', onError)
    }

    worker.addEventListener('message', onMessage as EventListener)
    worker.addEventListener('error', onError)
    worker.postMessage({ id, type: 'compileWasm', wasmUrl })
  })
}

/** Probe whether SW already cached the WASM URL (workbox cacheName phase-wasm). */
export async function isPhaseWasmCached(
  wasmUrl: string = PHASE_CDN.wasmUrl,
): Promise<boolean> {
  if (!('caches' in globalThis)) return false
  try {
    const cache = await caches.open('phase-wasm')
    if (await cache.match(wasmUrl)) return true
    // Also try without query / alternate absolute form
    const keys = await cache.keys()
    return keys.some((r) => r.url === wasmUrl || r.url.includes('engine_wasm_bg'))
  } catch {
    return false
  }
}

export function yieldToMain(): Promise<void> {
  const sched = (
    globalThis as unknown as {
      scheduler?: { yield?: () => Promise<void> }
    }
  ).scheduler
  if (sched?.yield) return sched.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function describeBootCache(opts: {
  wasmCached: boolean
  cardCached: boolean
}): string {
  if (opts.wasmCached && opts.cardCached) {
    return 'Already cached — instant boot'
  }
  if (opts.wasmCached) return 'WASM cached (service worker) · card-data may download'
  if (opts.cardCached) return 'Card-data cached · WASM may download'
  return 'First boot downloads WASM + card-data'
}
