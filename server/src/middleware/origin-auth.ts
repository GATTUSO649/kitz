import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'

const originAuthHeader = 'x-kitculture-origin-auth'
const publicHealthPaths = new Set(['/health/live', '/health/ready'])

export function createOriginAuthentication(expectedToken: string | undefined): RequestHandler {
  if (!expectedToken) return (_request, _response, next) => next()

  const expected = Buffer.from(expectedToken)
  return (request, response, next) => {
    if ((request.method === 'GET' || request.method === 'HEAD') && publicHealthPaths.has(request.path)) {
      next()
      return
    }

    const provided = Buffer.from(request.get(originAuthHeader) ?? '')
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      response.status(403).json({ error: { code: 'ORIGIN_AUTH_REQUIRED', message: 'Origin authentication failed.' } })
      return
    }
    next()
  }
}