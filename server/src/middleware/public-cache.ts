import type { RequestHandler } from 'express'

type CacheEntry = { body: string; expiresAt: number }

const cache = new Map<string, CacheEntry>()
const cacheTtlMs = 10_000
const cacheLimit = 250
const cacheControl = 'public, max-age=10, stale-while-revalidate=30'
const cacheablePaths = new Set([
  '/api/v1/categories',
  '/api/v1/marketplace',
  '/api/v1/products',
  '/api/v1/products/best-sellers',
  '/api/v1/products/featured',
  '/api/v1/products/new-arrivals',
  '/api/v1/products/trending',
  '/api/v1/store/homepage',
])

function isCacheablePath(path: string) {
  return cacheablePaths.has(path) || /^\/api\/v1\/products\/[a-z0-9-]+$/i.test(path)
}

export const publicApiCache: RequestHandler = (request, response, next) => {
  if (request.method !== 'GET' || !isCacheablePath(request.originalUrl.split('?')[0])) {
    next()
    return
  }

  const key = request.originalUrl
  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) {
    response.setHeader('Cache-Control', cacheControl)
    response.setHeader('X-Cache', 'HIT')
    response.type('application/json').send(cached.body)
    return
  }
  if (cached) cache.delete(key)

  const sendJson = response.json.bind(response)
  response.json = ((body: unknown) => {
    if (response.statusCode >= 200 && response.statusCode < 300
      && typeof body === 'object' && body !== null && 'data' in body) {
      const serialized = JSON.stringify(body)
      if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value as string)
      cache.set(key, { body: serialized, expiresAt: Date.now() + cacheTtlMs })
      response.setHeader('Cache-Control', cacheControl)
      response.setHeader('X-Cache', 'MISS')
    }
    return sendJson(body)
  }) as typeof response.json

  next()
}