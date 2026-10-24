/**
 * Hypergeometric probability helpers for draw odds.
 * Population N, K successes, draw n, want at least k successes.
 */

export function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  if (k === 0 || k === n) return 1
  k = Math.min(k, n - k)
  let num = 1
  let den = 1
  for (let i = 1; i <= k; i++) {
    num *= n - (k - i)
    den *= i
  }
  return num / den
}

export function hypergeometricPmf(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  if (n > N || K > N || k > n || k > K) return 0
  const den = combinations(N, n)
  if (den === 0) return 0
  return (combinations(K, k) * combinations(N - K, n - k)) / den
}

/** P(X >= k) */
export function hypergeometricAtLeast(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  let p = 0
  const maxK = Math.min(n, K)
  for (let i = k; i <= maxK; i++) {
    p += hypergeometricPmf(N, K, n, i)
  }
  return clamp01(p)
}

/** P(X <= k) */
export function hypergeometricAtMost(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  let p = 0
  const maxK = Math.min(n, K, k)
  for (let i = 0; i <= maxK; i++) {
    p += hypergeometricPmf(N, K, n, i)
  }
  return clamp01(p)
}

/** P(X === k) */
export function hypergeometricExact(
  N: number,
  K: number,
  n: number,
  k: number,
): number {
  return clamp01(hypergeometricPmf(N, K, n, k))
}

function clamp01(x: number): number {
  if (Number.isNaN(x) || !Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
}

export function pct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`
}
