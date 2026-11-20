import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import { adminDb } from '../config/database.js'
import { wafIpPolicies } from '../database/admin-schema.js'

export type IpPolicyAction = 'allow' | 'block' | 'challenge'
export type IpPolicyType = 'ip' | 'cidr'

export type IpPolicy = {
  id: string
  name: string
  action: IpPolicyAction
  type: IpPolicyType
  value: string
  enabled: boolean
  priority: number
  reason: string
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type IpPolicyDecision = {
  action: IpPolicyAction | 'allow'
  policyId: string | null
  matchedValue: string | null
  reason: string
}

const policies = new Map<string, IpPolicy>()
const auditTrail: Array<{ id: string; policyId: string; action: string; value: string; occurredAt: string }> = []

function normalizeCandidate(value: string | null | undefined): string | null {
  if (value == null) return null
  const candidate = String(value).trim().replace(/^\[|\]$/g, '').split(',')[0]?.trim()
  if (!candidate) return null
  if (candidate.startsWith('::ffff:')) return candidate.slice(7)
  return candidate
}

function parseIPv4(value: string): number | null {
  const parts = value.split('.')
  if (parts.length !== 4) return null
  const octets = parts.map((part) => Number(part))
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets.reduce((running, octet) => (running << 8) + octet, 0)
}

function convertIPv6ToBigInt(value: string): bigint | null {
  const normalized = value.replace(/\[|\]/g, '')
  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : []
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : []
  const missing = 8 - (left.length + right.length)
  if (missing < 0) return null
  const groups = [...left, ...new Array(Math.max(0, missing)).fill('0'), ...right]
  if (groups.length !== 8) return null
  let result = 0n
  for (const group of groups) {
    const groupValue = Number.parseInt(group || '0', 16)
    if (!Number.isFinite(groupValue) || groupValue < 0 || groupValue > 0xffff) return null
    result = (result << 16n) + BigInt(groupValue)
  }
  return result
}

function parseIpToBigInt(value: string): bigint | null {
  const candidate = normalizeCandidate(value)
  if (!candidate) return null
  if (isIP(candidate) === 4) return BigInt(parseIPv4(candidate) ?? 0)
  if (isIP(candidate) === 6) return convertIPv6ToBigInt(candidate)
  return null
}

function parseCidrMatch(value: string): { address: bigint; bitLength: number; prefixLength: number } | null {
  const candidate = normalizeCandidate(value)
  if (!candidate || !candidate.includes('/')) return null
  const [addressPart, prefixPart] = candidate.split('/')
  if (!addressPart || prefixPart === undefined) return null
  const prefixLength = Number(prefixPart)
  if (!Number.isInteger(prefixLength)) return null
  const ipVersion = isIP(addressPart)
  const bitLength = ipVersion === 4 ? 32 : ipVersion === 6 ? 128 : null
  if (bitLength === null) return null
  if (prefixLength < 0 || prefixLength > bitLength) return null
  const address = parseIpToBigInt(addressPart)
  if (address === null) return null
  return { address, bitLength, prefixLength }
}

function cidrMatches(ip: string, cidr: string): boolean {
  const address = parseIpToBigInt(ip)
  const network = parseCidrMatch(cidr)
  if (address === null || network === null) return false
  const mask = network.prefixLength === 0 ? 0n : ((1n << BigInt(network.prefixLength)) - 1n) << BigInt(network.bitLength - network.prefixLength)
  return (address & mask) === (network.address & mask)
}

function normalizePolicyValue(type: IpPolicyType, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('IP policy value cannot be empty.')
  const candidate = type === 'cidr' ? trimmed : trimmed
  const matchesIp = !candidate.includes('/') && isIP(candidate) !== 0
  const matchesCidr = candidate.includes('/') && parseCidrMatch(candidate) !== null
  if (!matchesIp && !matchesCidr) {
    throw new Error('IP policy value must be a valid IPv4, IPv6, or CIDR range.')
  }
  return candidate
}

export function getClientIp(input: { ip?: string; headers?: Record<string, string | string[] | undefined> }): string {
  const forwarded = input.headers?.['x-forwarded-for']
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const forwardCandidate = typeof forwardedValue === 'string' ? forwardedValue.split(',')[0]?.trim() : null
  if (forwardCandidate) return normalizeCandidate(forwardCandidate) ?? 'unknown'
  const realIp = input.headers?.['x-real-ip']
  const realIpValue = Array.isArray(realIp) ? realIp[0] : realIp
  if (typeof realIpValue === 'string' && realIpValue.trim()) return normalizeCandidate(realIpValue) ?? 'unknown'
  return normalizeCandidate(input.ip ?? 'unknown') ?? 'unknown'
}

export function expirePolicies(now = new Date()) {
  let expired = 0
  for (const [id, policy] of [...policies.entries()]) {
    if (policy.enabled && policy.expiresAt && policy.expiresAt.getTime() <= now.getTime()) {
      policies.delete(id)
      expired++
    }
  }
  return expired
}

export function listIpPolicies() {
  expirePolicies()
  return [...policies.values()].sort((left, right) => right.priority - left.priority)
}

export function getIpPolicyAuditHistory() {
  return [...auditTrail].reverse()
}

export function addIpPolicy(input: Partial<Omit<IpPolicy, 'id' | 'createdAt' | 'updatedAt'>> & { id?: string; value: string; name?: string; reason?: string; expiresAt?: Date | string | null }): IpPolicy {
  const type = input.type ?? (input.value.includes('/') ? 'cidr' : 'ip')
  const value = normalizePolicyValue(type, input.value)
  const now = new Date()
  const policy: IpPolicy = {
    id: input.id ?? randomUUID(),
    name: input.name?.trim() || `${type.toUpperCase()} policy`,
    action: input.action ?? 'block',
    type,
    value,
    enabled: input.enabled ?? true,
    priority: input.priority ?? 50,
    reason: input.reason?.trim() || 'Administrative IP restriction.',
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    createdAt: now,
    updatedAt: now,
  }
  policies.set(policy.id, policy)
  auditTrail.push({ id: randomUUID(), policyId: policy.id, action: 'created', value: policy.value, occurredAt: now.toISOString() })
  return { ...policy }
}

export function updateIpPolicy(id: string, patch: Partial<Omit<IpPolicy, 'id' | 'createdAt' | 'updatedAt'>> & { expiresAt?: Date | string | null }): IpPolicy | null {
  const existing = policies.get(id)
  if (!existing) return null
  const next: IpPolicy = {
    ...existing,
    ...patch,
    type: patch.type ?? existing.type,
    value: patch.value ? normalizePolicyValue(patch.type ?? existing.type, patch.value) : existing.value,
    action: patch.action ?? existing.action,
    enabled: patch.enabled ?? existing.enabled,
    priority: patch.priority ?? existing.priority,
    reason: patch.reason?.trim() ?? existing.reason,
    expiresAt: patch.expiresAt === undefined ? existing.expiresAt : patch.expiresAt === null ? null : new Date(patch.expiresAt),
    updatedAt: new Date(),
  }
  policies.set(id, next)
  auditTrail.push({ id: randomUUID(), policyId: id, action: 'updated', value: next.value, occurredAt: next.updatedAt.toISOString() })
  return { ...next }
}

export function removeIpPolicy(id: string): boolean {
  const removed = policies.delete(id)
  if (removed) {
    auditTrail.push({ id: randomUUID(), policyId: id, action: 'deleted', value: 'removed', occurredAt: new Date().toISOString() })
  }
  return removed
}

export function clearIpPolicies() {
  policies.clear()
}

export async function loadPersistedIpPolicies() {
  if (!adminDb) return
  const rows = await adminDb.select().from(wafIpPolicies)
  policies.clear()
  for (const row of rows) {
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) continue
    policies.set(row.id, {
      id: row.id,
      name: row.name,
      action: row.action,
      type: row.type,
      value: row.value,
      enabled: row.enabled,
      priority: row.priority,
      reason: row.reason,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })
  }
}

export function evaluateIpPolicy(ipInput: string | null | undefined): IpPolicyDecision {
  const ip = normalizeCandidate(ipInput ?? '')
  if (!ip) {
    return { action: 'allow', policyId: null, matchedValue: null, reason: 'No valid IP address provided.' }
  }

  expirePolicies()
  const matches = listIpPolicies().filter((policy) => policy.enabled)
  for (const policy of matches) {
    const policyValue = normalizeCandidate(policy.value)
    if (!policyValue) continue
    if (policy.type === 'ip' && policyValue === ip) {
      return { action: policy.action, policyId: policy.id, matchedValue: policy.value, reason: policy.reason || 'Matched explicit IP policy.' }
    }
    if (policy.type === 'cidr' && cidrMatches(ip, policyValue)) {
      return { action: policy.action, policyId: policy.id, matchedValue: policy.value, reason: policy.reason || 'Matched CIDR policy.' }
    }
  }

  return { action: 'allow', policyId: null, matchedValue: null, reason: 'No active IP policy matched the request.' }
}

export function matchesPolicy(ip: string, policy: Pick<IpPolicy, 'type' | 'value'>): boolean {
  const candidate = normalizeCandidate(ip)
  const policyValue = normalizeCandidate(policy.value)
  if (!candidate || !policyValue) return false
  return policy.type === 'ip' ? candidate === policyValue : cidrMatches(candidate, policyValue)
}
