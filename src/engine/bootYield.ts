/** Cooperative yields so React can paint between heavy boot steps. */

export function yieldToMain(): Promise<void> {
  const sched = (
    globalThis as unknown as {
      scheduler?: { yield?: () => Promise<void> }
    }
  ).scheduler
  if (typeof sched?.yield === 'function') return sched.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Prefer idle time for CPU-heavy chunk work; falls back to yieldToMain. */
export function yieldIdle(timeoutMs = 48): Promise<void> {
  const ric = (
    globalThis as unknown as {
      requestIdleCallback?: (
        cb: (deadline: { timeRemaining: () => number }) => void,
        opts?: { timeout: number },
      ) => number
    }
  ).requestIdleCallback
  if (typeof ric === 'function') {
    return new Promise((resolve) => {
      ric(() => resolve(), { timeout: timeoutMs })
    })
  }
  return yieldToMain()
}

/** Double-rAF so the browser can commit progress UI before a sync hitch. */
export function yieldForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}
