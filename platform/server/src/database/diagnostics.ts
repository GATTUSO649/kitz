export type DatabaseFailureKind = 'missing_schema' | 'missing_relation' | 'permission_denied' | 'authentication_failed' | 'database_missing' | 'connection_timeout' | 'connection_unavailable' | 'query_timeout' | 'database_error'

export type SafeDatabaseError = {
  name: string
  message: string
  code?: string
  failureKind: DatabaseFailureKind
  schema?: string
  table?: string
  constraint?: string
}

function redactSensitiveText(value: string, env: NodeJS.ProcessEnv): string {
  let result = value.replace(/\b(?:postgres(?:ql)?|mysql):\/\/[^\s"'<>]+/gi, '[DATABASE_URL_REDACTED]')
  result = result.replace(/((?:password|passwd|pass|api[_-]?key|secret|token|authorization|smtp[_-]?(?:user|password)|database[_-]?(?:url|ca|certificate))\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
  for (const [name, secret] of Object.entries(env)) {
    if (!secret || !/(?:PASSWORD|PASS|SECRET|TOKEN|API_KEY|DATABASE_URL|DATABASE_CA|CERTIFICATE|PRIVATE_KEY)/i.test(name)) continue
    result = result.replaceAll(secret, '[REDACTED]')
  }
  return result
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current) && chain.length < 8) {
    seen.add(current)
    const candidate = current as Record<string, unknown>
    chain.push(candidate)
    current = candidate.cause
  }
  return chain
}

function failureKind(code: string | undefined, message: string): DatabaseFailureKind {
  if (code === '3F000' || /schema ["']?[^"']+["']? does not exist/i.test(message)) return 'missing_schema'
  if (code === '42P01' || /relation ["']?[^"']+["']? does not exist/i.test(message)) return 'missing_relation'
  if (code === '42501' || /permission denied/i.test(message)) return 'permission_denied'
  if (code === '28P01' || code === '28000') return 'authentication_failed'
  if (code === '3D000') return 'database_missing'
  if (code === '57014' || /statement timeout|query timeout/i.test(message)) return 'query_timeout'
  if (code === 'ETIMEDOUT' || /connection timeout|connect timeout/i.test(message)) return 'connection_timeout'
  if (/^(?:08|53|57|58)[0-9A-Z]{3}$/.test(code ?? '') || /^(?:ECONN|EPIPE|ENOTFOUND|EAI_AGAIN|ConnectionError)/i.test(code ?? '') || /connection (?:terminated|refused|closed|reset)/i.test(message)) return 'connection_unavailable'
  return 'database_error'
}

export function safeDatabaseError(error: unknown, env: NodeJS.ProcessEnv = process.env): SafeDatabaseError | undefined {
  const chain = errorChain(error)
  const candidate = chain.find((entry) => {
    const code = typeof entry.code === 'string' ? entry.code : ''
    const message = typeof entry.message === 'string' ? entry.message : ''
    return /^[0-9A-Z]{5}$/.test(code)
      || /^(?:ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN)/i.test(code)
      || entry.name === 'PostgresError'
      || /(?:connection|connect) timeout|timeout exceeded.*connect|permission denied for schema|relation ["']?[^"']+["']? does not exist|schema ["']?[^"']+["']? does not exist/i.test(message)
  })
  if (!candidate) return undefined

  const code = typeof candidate.code === 'string' && /^[0-9A-Z_]{1,32}$/.test(candidate.code) ? candidate.code : undefined
  const rawMessage = typeof candidate.message === 'string' ? candidate.message : 'PostgreSQL operation failed.'
  const output: SafeDatabaseError = {
    name: typeof candidate.name === 'string' ? redactSensitiveText(candidate.name, env) : 'DatabaseError',
    message: redactSensitiveText(rawMessage, env),
    ...(code ? { code } : {}),
    failureKind: failureKind(code, rawMessage),
  }
  for (const field of ['schema', 'table', 'constraint'] as const) {
    const value = candidate[field]
    if (typeof value === 'string' && value.length <= 160) output[field] = redactSensitiveText(value, env)
  }
  return output
}

export function databaseErrorResponseCode(error: SafeDatabaseError | undefined): string {
  switch (error?.failureKind) {
    case 'missing_schema': return 'DATABASE_SCHEMA_MISSING'
    case 'missing_relation': return 'DATABASE_RELATION_MISSING'
    case 'permission_denied': return 'DATABASE_PERMISSION_DENIED'
    case 'authentication_failed': return 'DATABASE_AUTHENTICATION_FAILED'
    case 'database_missing': return 'DATABASE_NOT_FOUND'
    case 'connection_timeout': return 'DATABASE_CONNECTION_TIMEOUT'
    default: return 'DATABASE_UNAVAILABLE'
  }
}