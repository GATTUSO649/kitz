import type { ItAccessRole } from '../../database/admin-schema.js'

export const itPermissions = [
  'overview.read',
  'security.read',
  'security.scan',
  'security.findings.write',
  'incidents.read',
  'incidents.write',
  'audit.read',
  'database.read',
  'infrastructure.read',
] as const

export type ItPermission = typeof itPermissions[number]
export type OperationsRoutePermission = ItPermission | 'super_admin'

type OperationsPermissionRule = {
  path: RegExp
  read: OperationsRoutePermission
  write?: OperationsRoutePermission
}

const rolePermissions: Record<ItAccessRole, ReadonlySet<ItPermission>> = {
  super_admin: new Set(itPermissions),
  security_analyst: new Set(['overview.read', 'security.read', 'security.scan', 'security.findings.write', 'incidents.read', 'incidents.write', 'audit.read']),
  it_support: new Set(['overview.read', 'incidents.read', 'incidents.write']),
  database_admin: new Set(['overview.read', 'incidents.read', 'incidents.write', 'audit.read', 'database.read']),
  infrastructure_admin: new Set(['overview.read', 'incidents.read', 'incidents.write', 'audit.read', 'infrastructure.read']),
  viewer: new Set(['overview.read']),
}

export function hasItPermission(role: ItAccessRole, permission: ItPermission): boolean {
  return rolePermissions[role].has(permission)
}

const operationsPermissionRules: OperationsPermissionRule[] = [
  { path: /^\/me\/?$/, read: 'overview.read' },
  { path: /^\/(?:operators|permissions)(?:\/|$)/, read: 'super_admin', write: 'super_admin' },
  { path: /^\/(?:telemetry|health|overview)\/?$/, read: 'overview.read' },
  { path: /^\/detections\/?$/, read: 'security.read' },
  { path: /^\/workers\/?$/, read: 'infrastructure.read' },
  { path: /^\/events(?:\/|$)/, read: 'security.read' },
  { path: /^\/alerts(?:\/|$)/, read: 'incidents.read', write: 'incidents.write' },
  { path: /^\/metrics\/?$/, read: 'security.read' },
  { path: /^\/database-performance(?:\/|$)/, read: 'database.read' },
  { path: /^\/(?:runtime-performance|provider-performance)\/?$/, read: 'infrastructure.read' },
  { path: /^\/incidents(?:\/|$)/, read: 'incidents.read', write: 'incidents.write' },
  { path: /^\/audit(?:\/|$)/, read: 'audit.read' },
  { path: /^\/security\/scans\/?$/, read: 'security.read', write: 'security.scan' },
  { path: /^\/security\/scans\/[^/]+\/cancel\/?$/, read: 'security.read', write: 'security.scan' },
  { path: /^\/security\/findings\/[^/]+\/status\/?$/, read: 'security.read', write: 'security.findings.write' },
  { path: /^\/security(?:\/|$)/, read: 'security.read' },
]

export function operationsPermissionForRoute(method: string, path: string): OperationsRoutePermission | null {
  const rule = operationsPermissionRules.find((candidate) => candidate.path.test(path))
  if (!rule) return null
  return method === 'GET' || method === 'HEAD' ? rule.read : rule.write ?? rule.read
}

export function hasOperationsRoutePermission(role: ItAccessRole, method: string, path: string) {
  const permission = operationsPermissionForRoute(method, path)
  if (!permission) return false
  return permission === 'super_admin' ? role === 'super_admin' : hasItPermission(role, permission)
}