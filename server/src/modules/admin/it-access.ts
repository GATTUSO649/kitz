import type { ItAccessRole } from '../../database/admin-schema.js'

export const itPermissions = [
  'overview.read',
  'security.read',
  'incidents.read',
  'incidents.write',
  'audit.read',
  'database.read',
  'infrastructure.read',
] as const

export type ItPermission = typeof itPermissions[number]

const rolePermissions: Record<ItAccessRole, ReadonlySet<ItPermission>> = {
  super_admin: new Set(itPermissions),
  security_analyst: new Set(['overview.read', 'security.read', 'incidents.read', 'incidents.write', 'audit.read']),
  it_support: new Set(['overview.read', 'incidents.read', 'incidents.write']),
  database_admin: new Set(['overview.read', 'incidents.read', 'incidents.write', 'audit.read', 'database.read']),
  infrastructure_admin: new Set(['overview.read', 'incidents.read', 'incidents.write', 'audit.read', 'infrastructure.read']),
  viewer: new Set(['overview.read']),
}

export function hasItPermission(role: ItAccessRole, permission: ItPermission): boolean {
  return rolePermissions[role].has(permission)
}