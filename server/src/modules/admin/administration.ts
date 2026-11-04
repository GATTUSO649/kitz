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
  'application.manage_settings',
  'it.view_operations',
  'it.manage_monitoring',
  'sales.view',
  'sales.manage_orders',
  'sales.manage_customers',
  'sales.manage_products',
  'sales.manage_catalogue',
  'finance.view',
  'finance.view_transactions',
  'finance.manage_refunds',
  'finance.manage_expenses',
  'finance.manage_settings',
  'inventory.dashboard.view',
  'inventory.stock.view',
  'inventory.stock.adjust',
  'inventory.stock.movements.view',
  'inventory.suppliers.view',
  'inventory.suppliers.manage',
  'inventory.purchase_orders.view',
  'inventory.purchase_orders.create',
  'inventory.purchase_orders.approve',
  'inventory.receiving.manage',
  'inventory.fulfillment.view',
  'inventory.fulfillment.manage',
  'inventory.returns.view',
  'inventory.returns.approve',
  'inventory.reports.view',
  'inventory.reports.export',
  'inventory.audit.view',
  'inventory.settings.manage',
  'inventory.manage_stock',
  'inventory.manage_suppliers',
  'inventory.manage_fulfilment',
  'marketing.dashboard.view',
  'marketing.campaigns.view',
  'marketing.campaigns.create',
  'marketing.campaigns.edit',
  'marketing.campaigns.approve',
  'marketing.campaigns.publish',
  'marketing.promotions.view',
  'marketing.promotions.manage',
  'marketing.coupons.view',
  'marketing.coupons.manage',
  'marketing.audiences.view',
  'marketing.audiences.manage',
  'marketing.email.view',
  'marketing.email.create',
  'marketing.email.send',
  'marketing.notifications.manage',
  'marketing.content.manage',
  'marketing.analytics.view',
  'marketing.reports.export',
  'marketing.audit.view',
  'marketing.settings.manage',
  'marketing.manage_campaigns',
  'marketing.manage_promotions',
  'content.manage_products',
  'content.manage_categories',
  'content.manage_content',
] as const

export type AdministratorPermission = typeof administratorPermissions[number]

export const defaultAdministratorPermissions: Record<AdministratorRole, ReadonlySet<AdministratorPermission>> = {
  super_admin: new Set(administratorPermissions),
  it_admin: new Set(['administrators.view', 'audit.view', 'it.view_operations', 'it.manage_monitoring']),
  sales_admin: new Set(['sales.view', 'sales.manage_orders', 'sales.manage_customers', 'sales.manage_products', 'sales.manage_catalogue', 'application.manage_settings', 'audit.view']),
  finance_admin: new Set(['finance.view', 'finance.view_transactions', 'finance.manage_refunds', 'finance.manage_expenses', 'finance.manage_settings', 'audit.view']),
  inventory_admin: new Set(['inventory.dashboard.view', 'inventory.stock.view', 'inventory.stock.adjust', 'inventory.stock.movements.view', 'inventory.suppliers.view', 'inventory.suppliers.manage', 'inventory.purchase_orders.view', 'inventory.purchase_orders.create', 'inventory.purchase_orders.approve', 'inventory.receiving.manage', 'inventory.fulfillment.view', 'inventory.fulfillment.manage', 'inventory.returns.view', 'inventory.returns.approve', 'inventory.reports.view', 'inventory.reports.export', 'inventory.audit.view', 'inventory.settings.manage', 'inventory.manage_stock', 'inventory.manage_suppliers', 'inventory.manage_fulfilment', 'audit.view']),
  marketing_admin: new Set(['marketing.dashboard.view', 'marketing.campaigns.view', 'marketing.campaigns.create', 'marketing.campaigns.edit', 'marketing.campaigns.publish', 'marketing.promotions.view', 'marketing.promotions.manage', 'marketing.coupons.view', 'marketing.coupons.manage', 'marketing.audiences.view', 'marketing.audiences.manage', 'marketing.email.view', 'marketing.email.create', 'marketing.notifications.manage', 'marketing.content.manage', 'marketing.analytics.view', 'marketing.reports.export', 'marketing.audit.view', 'marketing.settings.manage', 'marketing.manage_campaigns', 'marketing.manage_promotions', 'audit.view']),
  content_admin: new Set(['content.manage_products', 'content.manage_categories', 'content.manage_content', 'audit.view']),
}

export function hasAdministratorPermission(role: AdministratorRole | null | undefined, permission: AdministratorPermission) {
  return Boolean(role && defaultAdministratorPermissions[role]?.has(permission))
}

export function rolePrefix(role: AdministratorRole) {
  return ({ super_admin: 'SUPER', it_admin: 'IT', sales_admin: 'SALES', finance_admin: 'FIN', inventory_admin: 'INV', marketing_admin: 'MKT', content_admin: 'CONTENT' })[role]
}

export function administratorPortal(role: AdministratorRole) {
  return ({
    super_admin: '/super-admin/dashboard',
    it_admin: '/it-admin/dashboard',
    sales_admin: '/admin/dashboard',
    finance_admin: '/finance-admin/dashboard',
    inventory_admin: '/inventory-admin/dashboard',
    marketing_admin: '/marketing-admin/dashboard',
    content_admin: '/content-admin/dashboard',
  })[role]
}

export function requiredAdministratorRole(requestPath: string, expectedRole?: AdministratorRole) {
  return requestPath === '/super-admin/login' ? 'super_admin' : expectedRole
}
