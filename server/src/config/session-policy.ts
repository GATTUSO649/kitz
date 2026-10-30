export const customerSessionIdleTimeoutMs = 60 * 60_000
export const customerSessionAbsoluteLifetimeMs = 30 * 24 * 60 * 60_000
export const adminSessionIdleTimeoutMs = 15 * 60_000
export const adminSessionAbsoluteLifetimeMs = 8 * 60 * 60_000

export function nextSessionExpiry(createdAt: Date, now: Date, idleTimeoutMs: number, absoluteLifetimeMs: number): Date | null {
  const absoluteExpiry = createdAt.getTime() + absoluteLifetimeMs
  if (!Number.isFinite(absoluteExpiry) || absoluteExpiry <= now.getTime()) return null
  return new Date(Math.min(now.getTime() + idleTimeoutMs, absoluteExpiry))
}

export function shouldRefreshSession(expiresAt: Date, now: Date, idleTimeoutMs: number): boolean {
  return expiresAt.getTime() - now.getTime() <= idleTimeoutMs / 3
}