import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { env } from '../../config/env.js'
import { getMonitoringContext } from './monitoring-context.js'

type QueryCallback = (...args: unknown[]) => void
type PgQueryable = { query: (...args: unknown[]) => unknown }
type PgPool = PgQueryable & {
  connect: (...args: unknown[]) => unknown
  totalCount?: number
  idleCount?: number
  waitingCount?: number
  options?: { max?: number }
}

export type DatabaseMeasurement = {
  eventType: 'database.query.completed' | 'database.connection.acquired' | 'database.transaction.completed'
  severity: 'info' | 'warning' | 'error' | 'critical'
  metadata: Record<string, string | number | boolean | null>
  requestId?: string
  correlationId?: string
  route?: string
}

export type DatabasePoolSnapshot = {
  totalConnections: number
  idleConnections: number
  waitingRequests: number
  maxConnections: number | null
}

type QueryDescription = { operation: string; fingerprint: string }

function queryDescription(query: unknown): QueryDescription {
  const text = typeof query === 'string'
    ? query
    : query && typeof query === 'object' && 'text' in query && typeof query.text === 'string'
      ? query.text
      : ''
  const normalized = text
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\$[a-zA-Z0-9_]*\$[\s\S]*?\$[a-zA-Z0-9_]*\$/g, '?')
    .replace(/'(?:''|\\.|[^'])*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
  const operation = /^([a-z]+)/i.exec(text.trim())?.[1]?.toUpperCase() ?? 'OTHER'
  return {
    operation: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'BEGIN', 'COMMIT', 'ROLLBACK'].includes(operation) ? operation : 'OTHER',
    fingerprint: createHash('sha256').update(normalized || 'unknown').digest('hex').slice(0, 32),
  }
}

function sqlState(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : null
}

function errorSeverity(state: string | null): DatabaseMeasurement['severity'] {
  if (state?.startsWith('08')) return 'critical'
  if (state?.startsWith('40')) return 'error'
  return 'warning'
}

function errorCategory(state: string | null): string {
  if (!state) return 'unknown'
  if (state.startsWith('08')) return 'connection'
  if (state.startsWith('23')) return 'integrity'
  if (state.startsWith('28')) return 'authorization'
  if (state.startsWith('40')) return 'transaction'
  if (state.startsWith('53')) return 'resource'
  if (state === '57014') return 'query_canceled_or_timeout'
  if (state.startsWith('42')) return 'query_or_schema'
  return 'database'
}

function durationSeverity(durationMs: number): DatabaseMeasurement['severity'] {
  if (durationMs >= env.DATABASE_SLOW_QUERY_CRITICAL_MS) return 'critical'
  if (durationMs >= env.DATABASE_SLOW_QUERY_ERROR_MS) return 'error'
  if (durationMs >= env.DATABASE_SLOW_QUERY_WARNING_MS) return 'warning'
  return 'info'
}

function resultRowCount(result: unknown): number | null {
  return result && typeof result === 'object' && 'rowCount' in result && typeof result.rowCount === 'number'
    ? result.rowCount
    : null
}

function recordMeasurement(
  observer: (measurement: DatabaseMeasurement) => void,
  eventType: DatabaseMeasurement['eventType'],
  severity: DatabaseMeasurement['severity'],
  metadata: DatabaseMeasurement['metadata'],
) {
  const context = getMonitoringContext()
  if (context?.suppressDatabaseMonitoring) return
  try {
    const route = context?.resolveRoute?.()
    observer({
      eventType,
      severity,
      metadata: { ...metadata, ...(route ? { route } : {}) },
      ...(context?.requestId ? { requestId: context.requestId } : {}),
      ...(context?.correlationId ? { correlationId: context.correlationId } : {}),
      ...(route ? { route } : {}),
    })
  } catch {
    // Monitoring observers must not affect database operations.
  }
}

function instrumentQuery(
  queryable: PgQueryable,
  observer: (measurement: DatabaseMeasurement) => void,
  transactionStartedAt?: WeakMap<object, number>,
) {
  const originalQuery = queryable.query.bind(queryable)
  queryable.query = (...args: unknown[]) => {
    if (getMonitoringContext()?.suppressDatabaseMonitoring) return originalQuery(...args)
    const startedAt = performance.now()
    const description = queryDescription(args[0])
    const operation = description.operation
    let completed = false
    const complete = (error: unknown, result?: unknown) => {
      if (completed) return
      completed = true
      const durationMs = Number(Math.max(0, performance.now() - startedAt).toFixed(2))
      const state = sqlState(error)
      recordMeasurement(observer, 'database.query.completed', error ? errorSeverity(state) : durationSeverity(durationMs), {
        operation,
        queryFingerprint: description.fingerprint,
        durationMs,
        outcome: error ? 'failed' : 'success',
        sqlState: state,
        errorCategory: error ? errorCategory(state) : null,
        affectedRows: resultRowCount(result),
      })

      if (!transactionStartedAt || !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(operation)) return
      const client = queryable as object
      if (operation === 'BEGIN' && !error) {
        transactionStartedAt.set(client, performance.now())
        return
      }
      const transactionStart = transactionStartedAt.get(client)
      if (transactionStart === undefined) return
      if (operation === 'COMMIT' || operation === 'ROLLBACK') {
        transactionStartedAt.delete(client)
        const transactionDurationMs = Number(Math.max(0, performance.now() - transactionStart).toFixed(2))
        const outcome = error ? 'failed' : operation === 'COMMIT' ? 'committed' : 'rolled_back'
        recordMeasurement(observer, 'database.transaction.completed', error ? errorSeverity(state) : outcome === 'rolled_back' ? 'warning' : durationSeverity(transactionDurationMs), {
          durationMs: transactionDurationMs,
          outcome,
          sqlState: state,
          errorCategory: error ? errorCategory(state) : null,
        })
      }
    }

    const callbackIndex = args.findIndex((argument, index) => index > 0 && typeof argument === 'function')
    if (callbackIndex >= 0) {
      const callback = args[callbackIndex] as QueryCallback
      args[callbackIndex] = (...callbackArgs: unknown[]) => {
        complete(callbackArgs[0], callbackArgs[1])
        callback(...callbackArgs)
      }
      try { return originalQuery(...args) } catch (error) { complete(error); throw error }
    }

    try {
      const result = originalQuery(...args)
      if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
        return Promise.resolve(result).then((value) => {
          complete(null, value)
          return value
        }, (error: unknown) => {
          complete(error)
          throw error
        })
      }
      return result
    } catch (error) {
      complete(error)
      throw error
    }
  }
}

export function instrumentPostgresPool(pool: PgPool, observer: (measurement: DatabaseMeasurement) => void) {
  const clients = new WeakSet<object>()
  const transactionStartedAt = new WeakMap<object, number>()

  const originalConnect = pool.connect.bind(pool)
  pool.connect = (...args: unknown[]) => {
    const startedAt = performance.now()
    const callbackIndex = args.findIndex((argument) => typeof argument === 'function')
    const handleClient = (client: unknown, error: unknown) => {
      recordMeasurement(observer, 'database.connection.acquired', error ? errorSeverity(sqlState(error)) : 'info', {
        waitMs: Number(Math.max(0, performance.now() - startedAt).toFixed(2)),
        outcome: error ? 'failed' : 'acquired',
        sqlState: sqlState(error),
        errorCategory: error ? errorCategory(sqlState(error)) : null,
      })
      if (!error && client && typeof client === 'object' && !clients.has(client)) {
        clients.add(client)
        instrumentQuery(client as PgQueryable, observer, transactionStartedAt)
      }
    }

    if (callbackIndex >= 0) {
      const callback = args[callbackIndex] as QueryCallback
      args[callbackIndex] = (...callbackArgs: unknown[]) => {
        handleClient(callbackArgs[1], callbackArgs[0])
        callback(...callbackArgs)
      }
      try { return originalConnect(...args) } catch (error) { handleClient(undefined, error); throw error }
    }

    const result = originalConnect(...args)
    if (result && typeof result === 'object' && 'then' in result && typeof result.then === 'function') {
      return Promise.resolve(result).then((client) => {
        handleClient(client, null)
        return client
      }, (error: unknown) => {
        handleClient(undefined, error)
        throw error
      })
    }
    return result
  }

  return () => getDatabasePoolSnapshot(pool)
}

export function getDatabasePoolSnapshot(pool: PgPool | null): DatabasePoolSnapshot | null {
  if (!pool) return null
  return {
    totalConnections: pool.totalCount ?? 0,
    idleConnections: pool.idleCount ?? 0,
    waitingRequests: pool.waitingCount ?? 0,
    maxConnections: pool.options?.max ?? null,
  }
}

export function fingerprintSql(sql: string) {
  return queryDescription(sql).fingerprint
}