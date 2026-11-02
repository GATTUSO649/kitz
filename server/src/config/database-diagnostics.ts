export type DatabaseFailureCategory = 'connection' | 'missing_table' | 'missing_column' | 'query'

export type DatabaseErrorDetail = {
  name: string
  code?: string
  sqlState?: string
  errno?: number
  message: string
}

export type DatabaseErrorDiagnostics = {
  category: DatabaseFailureCategory | null
  errors: DatabaseErrorDetail[]
}

const connectionCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
  'HANDSHAKE_SSL_ERROR',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  '28P01',
  '3D000',
])

function safeMessage(error: Error, code?: string, sqlState?: string): string {
  if (/Failed query:/i.test(error.message)) return 'Drizzle query failed.'
  if (code === 'ER_NO_SUCH_TABLE' || sqlState === '42S02') return 'MySQL table is missing.'
  if (code === 'ER_BAD_FIELD_ERROR' || sqlState === '42S22') return 'MySQL column is missing.'
  if (code === '42P01' || sqlState === '42P01') return 'PostgreSQL table is missing.'
  if (code === '42703' || sqlState === '42703') return 'PostgreSQL column is missing.'
  if (code?.startsWith('ER_')) return 'MySQL query failed.'
  if (sqlState && !sqlState.startsWith('08')) return 'Database query failed.'
  return error.message
    .replace(/mysql(?:s)?:\/\/[^\s'"`]+/gi, '[redacted-db-url]')
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, '[redacted-db-url]')
    .replace(/Access denied for user\s+'[^']+'@'[^']+'/gi, 'Access denied for user [redacted]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Z]{2,}/gi, '[redacted-email]')
    .replace(/\b(?:phone|mobile|msisdn)(\s*[=:]\s*)\+?[\d ().-]{8,}/gi, '$1[redacted-number]')
    .replace(/(password\s*[=:]\s*)[^\s,;]+/gi, '$1[redacted]')
    .slice(0, 400)
}

function collectErrors(error: unknown): DatabaseErrorDetail[] {
  const collected: DatabaseErrorDetail[] = []
  const pending = [error]
  const seen = new Set<unknown>()

  while (pending.length && collected.length < 8) {
    const current = pending.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)

    const candidate = current as Error & {
      code?: unknown
      sqlState?: unknown
      sqlstate?: unknown
      errno?: unknown
      cause?: unknown
      errors?: unknown
    }
    const code = typeof candidate.code === 'string' && /^[A-Z0-9_]+$/.test(candidate.code)
      ? candidate.code
      : undefined
    const sqlStateValue = candidate.sqlState ?? candidate.sqlstate
    const sqlState = typeof sqlStateValue === 'string' && /^[0-9A-Z]{5}$/.test(sqlStateValue)
      ? sqlStateValue
      : undefined

    collected.push({
      name: typeof candidate.name === 'string' ? candidate.name : candidate.constructor?.name ?? 'Error',
      ...(code ? { code } : {}),
      ...(sqlState ? { sqlState } : {}),
      ...(typeof candidate.errno === 'number' ? { errno: candidate.errno } : {}),
      message: candidate instanceof Error ? safeMessage(candidate, code, sqlState) : 'Database operation failed.',
    })

    if ('cause' in candidate) pending.push(candidate.cause)
    if (Array.isArray(candidate.errors)) pending.push(...candidate.errors)
  }

  return collected
}

export function inspectDatabaseError(error: unknown): DatabaseErrorDiagnostics {
  const errors = collectErrors(error)
  const codes = new Set(errors.flatMap(({ code }) => code ? [code] : []))
  const sqlStates = errors.flatMap(({ sqlState }) => sqlState ? [sqlState] : [])
  let category: DatabaseFailureCategory | null = null

  if (errors.some(({ name }) => name === 'DrizzleQueryError')
    || errors.some(({ code }) => code?.startsWith('ER_'))
    || [...codes].some((code) => /^[0-9A-Z]{5}$/.test(code))
    || sqlStates.length > 0) category = 'query'
  if (codes.has('ER_BAD_FIELD_ERROR') || codes.has('42703') || sqlStates.includes('42S22') || sqlStates.includes('42703')) category = 'missing_column'
  if (codes.has('ER_NO_SUCH_TABLE') || codes.has('42P01') || sqlStates.includes('42S02') || sqlStates.includes('42P01')) category = 'missing_table'
  if ([...codes].some((code) => connectionCodes.has(code) || code.startsWith('08')) || sqlStates.some((state) => state.startsWith('08'))) {
    category = 'connection'
  }

  return { category, errors }
}