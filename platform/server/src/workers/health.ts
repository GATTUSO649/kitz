export type WorkerName = 'marketplace_email' | 'marketplace_listing_expiry'
export type WorkerErrorCategory = 'database' | 'provider' | 'application'

type WorkerState = {
  enabled: boolean
  lastStartedAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastRunCount: number
  consecutiveFailures: number
  nextRunAt: string | null
}

const workerStates: Record<WorkerName, WorkerState> = {
  marketplace_email: { enabled: false, lastStartedAt: null, lastSuccessAt: null, lastFailureAt: null, lastRunCount: 0, consecutiveFailures: 0, nextRunAt: null },
  marketplace_listing_expiry: { enabled: false, lastStartedAt: null, lastSuccessAt: null, lastFailureAt: null, lastRunCount: 0, consecutiveFailures: 0, nextRunAt: null },
}

export function setWorkerEnabled(worker: WorkerName, enabled: boolean): void {
  workerStates[worker].enabled = enabled
}

export function markWorkerStarted(worker: WorkerName): void {
  workerStates[worker].lastStartedAt = new Date().toISOString()
}

export function markWorkerSucceeded(worker: WorkerName, processedCount: number): void {
  const state = workerStates[worker]
  state.lastSuccessAt = new Date().toISOString()
  state.lastRunCount = processedCount
  state.consecutiveFailures = 0
}

export function scheduleWorkerNextRun(worker: WorkerName, nextRunAt: Date): void {
  workerStates[worker].nextRunAt = nextRunAt.toISOString()
}

export function markWorkerFailed(worker: WorkerName, nextRunAt: Date): void {
  const state = workerStates[worker]
  state.lastFailureAt = new Date().toISOString()
  state.consecutiveFailures += 1
  state.nextRunAt = nextRunAt.toISOString()
}

export function workerHealthSnapshot(): Record<WorkerName, WorkerState> {
  return {
    marketplace_email: { ...workerStates.marketplace_email },
    marketplace_listing_expiry: { ...workerStates.marketplace_listing_expiry },
  }
}

export function classifyWorkerError(error: unknown): WorkerErrorCategory {
  if (!error || typeof error !== 'object') return 'application'
  const candidate = error as { code?: unknown; name?: unknown; category?: unknown; cause?: unknown }
  if (candidate.category === 'database' || candidate.category === 'provider' || candidate.category === 'application') return candidate.category
  if (candidate.cause && candidate.cause !== error) return classifyWorkerError(candidate.cause)
  const code = typeof candidate.code === 'string' ? candidate.code : ''
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  if (/^(?:08|28|40|42|53|54|55|57|58)[0-9A-Z]{3}$/.test(code) || /^(?:ECONN|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|ConnectionError)/i.test(code) || name === 'PostgresError') return 'database'
  if (/SMTP|RESEND|EMAIL_PROVIDER/i.test(code) || /^(?:FetchError|RequestError)$/i.test(name)) return 'provider'
  return 'application'
}

function redactSensitiveText(value: string, env: NodeJS.ProcessEnv): string {
  let result = value.replace(/\b(?:postgres(?:ql)?|mysql):\/\/[^\s"'<>]+/gi, '[DATABASE_URL_REDACTED]')
  result = result.replace(/((?:password|passwd|pass|api[_-]?key|secret|token|authorization|smtp[_-]?(?:user|password)|database[_-]?url)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
  for (const [name, secret] of Object.entries(env)) {
    if (!secret || !/(?:PASSWORD|SECRET|TOKEN|API_KEY|DATABASE_URL|SMTP_USER|DATABASE_USER)/i.test(name)) continue
    result = result.replaceAll(secret, '[REDACTED]')
  }
  return result
}

export function safeWorkerError(error: unknown, env: NodeJS.ProcessEnv = process.env): { category: WorkerErrorCategory; name: string; message: string; code?: string; stack?: string } {
  const category = classifyWorkerError(error)
  if (!(error instanceof Error)) return { category, name: 'UnknownError', message: redactSensitiveText(String(error), env) }
  const candidate = error as Error & { code?: unknown }
  const code = typeof candidate.code === 'string' && /^[A-Z0-9_]{1,32}$/.test(candidate.code) ? candidate.code : undefined
  return {
    category,
    name: redactSensitiveText(error.name, env),
    message: redactSensitiveText(error.message, env),
    ...(code ? { code } : {}),
    ...(error.stack ? { stack: redactSensitiveText(error.stack, env) } : {}),
  }
}