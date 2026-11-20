import { createHash } from 'node:crypto'
import { rateLimit, type Options } from 'express-rate-limit'
import { ipKeyGenerator } from 'express-rate-limit'
import type { Request } from 'express'
import { RedisStore, type RedisReply } from 'rate-limit-redis'
import { createClient } from 'redis'
import { evaluateIpPolicy, getClientIp } from './ip-policy.js'

const commandTimeoutMs = 1_500
const redisUrl = process.env.REDIS_URL
if (process.env.NODE_ENV === 'production' && process.env.NODE_TEST_CONTEXT === undefined && !redisUrl) {
  throw new Error('REDIS_URL is required in production for shared request rate limiting.')
}

const redisClient = redisUrl ? createClient({
  url: redisUrl,
  disableOfflineQueue: true,
  socket: {
    connectTimeout: 5_000,
    reconnectStrategy: (retries) => Math.min(250 * 2 ** Math.min(retries, 4), 4_000),
  },
}) : null
let redisConnectionAttempt: Promise<void> | null = null

export interface RateLimitRedisClient {
  isReady: boolean
  sendCommand(command: string[], options?: { timeout?: number }): Promise<unknown>
}

redisClient?.on('error', () => {
  console.error('KitCulture shared rate-limit storage is unavailable.')
})

export class RateLimitStorageUnavailableError extends Error {
  readonly code = 'RATE_LIMIT_STORE_UNAVAILABLE'

  constructor() {
    super('Shared request limiting is temporarily unavailable.')
    this.name = 'RateLimitStorageUnavailableError'
  }
}

function openRedisConnection(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new RateLimitStorageUnavailableError()), 8_000)
    redisClient!.connect().then(() => {
      clearTimeout(timeout)
      resolve()
    }, (error) => {
      clearTimeout(timeout)
      reject(error)
    })
  })
}

async function ensureRedisConnection(): Promise<void> {
  if (!redisClient) throw new RateLimitStorageUnavailableError()
  if (!redisClient.isReady) {
    if (!redisClient.isOpen) {
      redisConnectionAttempt ??= openRedisConnection().catch((error) => {
        if (redisClient.isOpen) redisClient.destroy()
        throw error
      }).finally(() => { redisConnectionAttempt = null })
    }
    if (redisConnectionAttempt) await redisConnectionAttempt
    else await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new RateLimitStorageUnavailableError()), 5_000)
      const ready = () => finish()
      const error = () => finish(new RateLimitStorageUnavailableError())
      const finish = (failure?: Error) => {
        clearTimeout(timeout)
        redisClient.off('ready', ready)
        redisClient.off('error', error)
        if (failure) reject(failure)
        else resolve()
      }
      redisClient.once('ready', ready)
      redisClient.once('error', error)
    })
  }
  if (!redisClient.isReady) throw new RateLimitStorageUnavailableError()
}

export function createRedisRateLimitStore(
  prefix: string,
  client: RateLimitRedisClient | null = redisClient,
) {
  if (!client) throw new RateLimitStorageUnavailableError()
  return new RedisStore({
    prefix: `kitculture:${prefix}:`,
    sendCommand: async (...command: string[]): Promise<RedisReply> => {
      if (client === redisClient) await ensureRedisConnection()
      else if (!client.isReady) throw new RateLimitStorageUnavailableError()
      try {
        return await client.sendCommand(command, { timeout: commandTimeoutMs }) as RedisReply
      } catch {
        throw new RateLimitStorageUnavailableError()
      }
    },
  })
}

export function createSecurityRateLimiter(name: string, options: Partial<Options>) {
  const store = redisClient ? createRedisRateLimitStore(name) : undefined
  const limiter = rateLimit({
    ...options,
    keyGenerator: options.keyGenerator ?? ((request) => ipRateLimitKey(ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown'))),
    standardHeaders: options.standardHeaders ?? 'draft-8',
    legacyHeaders: false,
    passOnStoreError: false,
    ...(store ? { store } : {}),
  })

  return (request: Request, response: Parameters<typeof limiter>[1], next: Parameters<typeof limiter>[2]) => {
    const clientIp = getClientIp({ ip: request.ip, headers: request.headers as Record<string, string | string[] | undefined> })
    const decision = evaluateIpPolicy(clientIp)
    if (decision.action === 'block') {
      response.status(403).json({ error: { code: 'IP_POLICY_BLOCKED', message: 'The request was rejected by the current IP policy.' } })
      return
    }
    return limiter(request, response, next)
  }
}

export function accountRateLimitKey(identity: unknown): string | null {
  if (typeof identity !== 'string' || !identity.trim()) return null
  return `account:${createHash('sha256').update(identity.trim().toLowerCase()).digest('hex')}`
}

export function ipRateLimitKey(ip: string): string {
  return `ip:${createHash('sha256').update(ip).digest('hex')}`
}

export function createAccountRateLimiter(name: string, options: Partial<Options>, identity: (request: Request) => unknown) {
  return createSecurityRateLimiter(name, {
    ...options,
    keyGenerator: (request) => accountRateLimitKey(identity(request))
      ?? ipRateLimitKey(ipKeyGenerator(request.ip ?? request.socket.remoteAddress ?? 'unknown')),
  })
}

export async function connectRateLimitStore(): Promise<void> {
  if (!redisClient) return
  try {
    await ensureRedisConnection()
  } catch {
    throw new RateLimitStorageUnavailableError()
  }
}

export async function closeRateLimitStore(): Promise<void> {
  if (redisClient?.isOpen) await redisClient.close().catch(() => undefined)
}

export function getRateLimitStoreStatus() {
  return {
    configured: Boolean(redisClient),
    required: process.env.NODE_ENV === 'production',
    state: !redisClient ? 'not_configured' as const : redisClient.isReady ? 'ready' as const : 'unavailable' as const,
  }
}

export function isRateLimitStorageUnavailable(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    if (current instanceof RateLimitStorageUnavailableError
      || ('code' in current && current.code === 'RATE_LIMIT_STORE_UNAVAILABLE')) return true
    current = 'cause' in current ? current.cause : null
  }
  return false
}
