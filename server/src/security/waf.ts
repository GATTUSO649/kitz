import type { Request, RequestHandler } from 'express'
import { recordMonitoringEvent } from '../modules/operations/monitoring-recorder.js'
import { evaluateIpPolicy, getClientIp } from './ip-policy.js'

export type WafMode = 'disabled' | 'detect' | 'block'
export type WafFinding = { ruleId: string; severity: 'warning' | 'error'; component: 'path' | 'query' | 'body' | 'header' | 'method' }

type WafInput = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  query?: unknown
  body?: unknown
}

type WafRule = {
  ruleId: string
  severity: WafFinding['severity']
  component: WafFinding['component']
  pattern: RegExp
  blockable: boolean
}

const rules: WafRule[] = [
  { ruleId: 'waf.malformed-path-encoding', severity: 'error', component: 'path', pattern: /%(?![0-9a-f]{2})/i, blockable: true },
  { ruleId: 'waf.path-traversal', severity: 'error', component: 'path', pattern: /(?:^|[\\/])\.\.(?:[\\/]|$)/, blockable: true },
  { ruleId: 'waf.active-script-markup', severity: 'error', component: 'body', pattern: /<\s*(?:script|iframe|object)\b|javascript\s*:/i, blockable: true },
  { ruleId: 'waf.sql-injection-pattern', severity: 'warning', component: 'query', pattern: /\bunion\s+select\b|(?:'|%27)\s*(?:or|and)\s+\d+\s*=\s*\d+/i, blockable: false },
  { ruleId: 'waf.command-injection-pattern', severity: 'error', component: 'body', pattern: /(?:[;&|]\s*)(?:curl|wget|bash|powershell|cmd)(?:\s|$)|\$\([^)]{1,80}\)/i, blockable: false },
]

const allowedMethods = new Set(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'])
const acceptedMutationContentTypes = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data']

function stringValues(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || value === undefined) return []
  if (typeof value === 'string') return [value.slice(0, 4096)]
  if (Array.isArray(value)) return value.slice(0, 50).flatMap((item) => stringValues(item, depth + 1))
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).slice(0, 50).flatMap((item) => stringValues(item, depth + 1))
  return []
}

function decodePath(path: string) {
  try { return decodeURIComponent(path) } catch { return path }
}

export function inspectWafRequest(request: WafInput): WafFinding[] {
  if (!request.path.startsWith('/api/')) return []
  const findings = new Map<string, WafFinding>()
  const normalizedPath = decodePath(request.path)
  for (const rule of rules.slice(0, 2)) {
    if (rule.pattern.test(request.path) || rule.pattern.test(normalizedPath)) {
      findings.set(rule.ruleId, { ruleId: rule.ruleId, severity: rule.severity, component: rule.component })
    }
  }

  for (const [component, values] of [
    ['query', stringValues(request.query)],
    ['body', stringValues(request.body)],
  ] as const) {
    for (const rule of rules.slice(2)) {
      if (values.some((value) => rule.pattern.test(value))) {
        findings.set(rule.ruleId, { ruleId: rule.ruleId, severity: rule.severity, component })
      }
    }
  }

  const method = request.method.toUpperCase()
  if (!allowedMethods.has(method)) {
    findings.set('waf.disallowed-method', { ruleId: 'waf.disallowed-method', severity: 'error', component: 'method' })
  }

  const contentTypeValue = request.headers['content-type']
  const contentType = Array.isArray(contentTypeValue) ? contentTypeValue[0] ?? '' : contentTypeValue ?? ''
  if (['POST', 'PUT', 'PATCH'].includes(method) && contentType
    && !acceptedMutationContentTypes.some((accepted) => contentType.toLowerCase().startsWith(accepted))) {
    findings.set('waf.unexpected-content-type', { ruleId: 'waf.unexpected-content-type', severity: 'warning', component: 'header' })
  }

  return [...findings.values()]
}

export function decideWafAction(mode: WafMode, findings: WafFinding[]): 'disabled' | 'allowed' | 'logged' | 'blocked' {
  if (mode === 'disabled') return 'disabled'
  if (!findings.length) return 'allowed'
  return mode === 'block' && findings.some((finding) => ['waf.malformed-path-encoding', 'waf.path-traversal', 'waf.active-script-markup', 'waf.disallowed-method'].includes(finding.ruleId))
    ? 'blocked'
    : 'logged'
}

function safeRouteGroup(path: string) {
  if (path.startsWith('/api/v1/admin')) return '/api/v1/admin'
  if (path.startsWith('/api/v1/operations')) return '/api/v1/operations'
  if (path.startsWith('/api/v1/auth')) return '/api/v1/auth'
  if (path.startsWith('/api/v1/orders')) return '/api/v1/orders'
  return '/api/v1/other'
}

function recordWafEvent(request: Request, findings: WafFinding[], action: 'logged' | 'blocked') {
  const ruleIds = findings.map(({ ruleId }) => ruleId).join(',')
  const severity = findings.some(({ severity: itemSeverity }) => itemSeverity === 'error') ? 'error' : 'warning'
  recordMonitoringEvent({
    eventType: 'security.waf.request_inspected',
    category: 'security',
    severity,
    sourceService: 'kitculture-api',
    instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
    ...(typeof request.id === 'string' || typeof request.id === 'number' ? { requestId: String(request.id) } : {}),
    metadata: {
      ruleIds,
      action,
      method: request.method.toUpperCase(),
      routeGroup: safeRouteGroup(request.path),
      component: [...new Set(findings.map(({ component }) => component))].join(','),
    },
  })
}

export function createWafMiddleware(mode: WafMode): RequestHandler {
  return (request, response, next) => {
    if (mode === 'disabled' || !request.path.startsWith('/api/')) {
      next()
      return
    }

    const clientIp = getClientIp({ ip: request.ip, headers: request.headers as Record<string, string | string[] | undefined> })
    const ipDecision = evaluateIpPolicy(clientIp)
    if (ipDecision.action === 'block') {
      recordMonitoringEvent({
        eventType: 'security.ip_policy.blocked',
        category: 'security',
        severity: 'critical',
        sourceService: 'kitculture-api',
        instanceId: process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local',
        requestId: typeof request.id === 'string' || typeof request.id === 'number' ? String(request.id) : undefined,
        correlationId: undefined,
        metadata: {
          policyId: ipDecision.policyId,
          matchedValue: ipDecision.matchedValue,
          reason: ipDecision.reason,
          clientIp,
          path: request.path,
          method: request.method,
        },
      })
      response.setHeader('Cache-Control', 'no-store')
      response.status(403).json({ error: { code: 'IP_POLICY_BLOCKED', message: 'The request was rejected by the current IP policy.' } })
      return
    }

    const findings = inspectWafRequest(request)
    const action = decideWafAction(mode, findings)
    if (action === 'allowed') {
      next()
      return
    }
    if (action === 'disabled') {
      next()
      return
    }
    recordWafEvent(request, findings, action)
    request.log?.warn({ requestId: String(request.id), ruleIds: findings.map(({ ruleId }) => ruleId), action }, 'WAF request inspection result')
    if (action === 'blocked') {
      response.setHeader('Cache-Control', 'no-store')
      response.status(403).json({ error: { code: 'REQUEST_REJECTED_BY_SECURITY_POLICY', message: 'The request was rejected by the security policy.' } })
      return
    }
    next()
  }
}

export function getWafStatus(mode: WafMode) {
  return {
    mode,
    state: mode === 'disabled' ? 'disabled' : mode === 'block' ? 'blocking_high_confidence_rules' : 'detection_only',
    configuration: 'environment',
    policiesPersisted: true,
    externalEdgeProtection: 'unknown',
    rules: rules.map(({ ruleId, severity, component, blockable }) => ({ ruleId, severity, component, blockable })),
  }
}