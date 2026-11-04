import { and, eq, isNull } from 'drizzle-orm'
import { adminDb } from '../../config/database.js'
import { adminRolePermissions, adminUserPermissions, administratorRoles, type AdministratorRole } from '../../database/admin-schema.js'
import { administratorPermissions, defaultAdministratorPermissions, type AdministratorPermission } from './administration.js'

export const permissionDescriptions: Record<AdministratorPermission, string> = {
  'administrators.manage': 'Activate, suspend, disable, and manage administrator accounts.',
  'administrators.view': 'View the administrator directory and account details.',
  'roles.manage': 'Assign administrator portal roles and configure role permissions.',
  'permissions.manage': 'Review and edit role permissions and individual access overrides.',
  'invitations.manage': 'Create, resend, and review administrator invitations.',
  'sessions.revoke': 'Revoke administrator sessions.',
  'audit.view': 'View administrator audit events and account history.',
  'analytics.system': 'View system-wide and cross-portal business summaries.',
  'application.manage_settings': 'Manage supported shared application business settings.',
  'it.view_operations': 'View IT operations and monitoring information.',
  'it.manage_monitoring': 'Manage authorized IT monitoring and incidents.',
  'sales.view': 'View sales, orders, and customer operations.',
  'sales.manage_orders': 'Manage order status and fulfillment workflow.',
  'sales.manage_customers': 'View and manage customer support records.',
  'sales.manage_products': 'Create, edit, publish, and retire product catalogue records.',
  'sales.manage_catalogue': 'Manage categories, teams, collections, and catalogue imagery.',
  'finance.view': 'View finance summaries and financial reports.',
  'finance.view_transactions': 'View payment and transaction records.',
  'finance.manage_refunds': 'Authorize and process refunds.',
  'finance.manage_expenses': 'Create and manage business expenses.',
  'inventory.manage_stock': 'View stock levels and make audited stock adjustments.',
  'inventory.manage_suppliers': 'Manage suppliers and purchase workflows.',
  'inventory.manage_fulfilment': 'Manage fulfillment, dispatch, and delivery workflow.',
  'marketing.manage_campaigns': 'Manage authorized marketing and notification campaigns.',
  'marketing.manage_promotions': 'Manage promotions, coupons, and discounts.',
  'content.manage_products': 'Manage product records and imagery.',
  'content.manage_categories': 'Manage product categories and catalogue structure.',
  'content.manage_content': 'Manage homepage and website content.',
}

const permissionSet = new Set<string>(administratorPermissions)

export function resolveAdministratorPermissions(
  role: AdministratorRole | null,
  roleAssignments: readonly string[],
  userOverrides: readonly { permission: string; granted: boolean }[] = [],
): Set<AdministratorPermission> {
  if (!role) return new Set()
  if (role === 'super_admin') return new Set(administratorPermissions)

  const effective = new Set<AdministratorPermission>(roleAssignments.length
    ? roleAssignments.filter((permission): permission is AdministratorPermission => permissionSet.has(permission))
    : defaultAdministratorPermissions[role])

  for (const override of userOverrides) {
    if (!permissionSet.has(override.permission)) continue
    const permission = override.permission as AdministratorPermission
    if (override.granted) effective.add(permission)
    else effective.delete(permission)
  }
  return effective
}

export function validatePermissionSelection(permissions: readonly string[]): permissions is readonly AdministratorPermission[] {
  return new Set(permissions).size === permissions.length && permissions.every((permission) => permissionSet.has(permission))
}

export async function loadAdministratorPermissions(adminUserId: number, role: AdministratorRole | null) {
  if (!adminDb) return null
  if (!role) return new Set<AdministratorPermission>()
  if (role === 'super_admin') return new Set<AdministratorPermission>(administratorPermissions)

  const [roleRows, userRows] = await Promise.all([
    adminDb.select({ permission: adminRolePermissions.permission }).from(adminRolePermissions).where(eq(adminRolePermissions.role, role)),
    adminDb.select({ permission: adminUserPermissions.permission, granted: adminUserPermissions.granted }).from(adminUserPermissions)
      .where(and(eq(adminUserPermissions.adminUserId, adminUserId), isNull(adminUserPermissions.revokedAt))),
  ])
  return resolveAdministratorPermissions(role, roleRows.map(({ permission }) => permission), userRows)
}

export function isAdministratorRole(role: string): role is AdministratorRole {
  return (administratorRoles as readonly string[]).includes(role)
}
