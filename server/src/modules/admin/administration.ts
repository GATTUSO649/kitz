import type { AdministratorRole } from '../../database/admin-schema.js'

export const administratorRoles: AdministratorRole[] = ['super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin']

export const administratorPermissions = [
  'administrators.manage',
  'administrators.view',
  'roles.manage',
  'permissions.manage',
  'invitations.manage',
  'sessions.revoke',
  'audit.view',
  'analytics.system',
  'it.view_operations',
  'it.manage_monitoring',
  'sales.view',
  'sales.manage_orders',
  'sales.manage_customers',
  'finance.view',
  'finance.view_transactions',
  'finance.manage_refunds',
  'inventory.manage_stock',
  'inventory.manage_suppliers',
  'inventory.manage_fulfilment',
  'marketing.manage_campaigns',
  'marketing.manage_promotions',
  'content.manage_products',
  'content.manage_categories',
  'content.manage_content',
] as const

export type AdministratorPermission = typeof administratorPermissions[number]

const rolePermissions: Record<AdministratorRole, ReadonlySet<AdministratorPermission>> = {
  super_admin: new Set(administratorPermissions),
  it_admin: new Set(['administrators.view', 'audit.view', 'it.view_operations', 'it.manage_monitoring']),
  sales_admin: new Set(['sales.view', 'sales.manage_orders', 'sales.manage_customers']),
  finance_admin: new Set(['finance.view', 'finance.view_transactions', 'finance.manage_refunds']),
  inventory_admin: new Set(['inventory.manage_stock', 'inventory.manage_suppliers', 'inventory.manage_fulfilment']),
  marketing_admin: new Set(['marketing.manage_campaigns', 'marketing.manage_promotions']),
  content_admin: new Set(['content.manage_products', 'content.manage_categories', 'content.manage_content']),
}

export function hasAdministratorPermission(role: AdministratorRole | null | undefined, permission: AdministratorPermission) {
  return Boolean(role && rolePermissions[role]?.has(permission))
}

export function rolePrefix(role: AdministratorRole) {
  return ({ super_admin: 'SUPER', it_admin: 'IT', sales_admin: 'SALES', finance_admin: 'FIN', inventory_admin: 'INV', marketing_admin: 'MKT', content_admin: 'CONTENT' })[role]
}

export function administratorPortal(role: AdministratorRole) {
  return ({
    super_admin: '/super-admin/dashboard',
    it_admin: '/it-admin/dashboard',
    sales_admin: '/sales-admin/dashboard',
    finance_admin: '/finance-admin/dashboard',
    inventory_admin: '/inventory-admin/dashboard',
    marketing_admin: '/marketing-admin/dashboard',
    content_admin: '/content-admin/dashboard',
  })[role]
}
