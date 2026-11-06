import type { AdministratorRole } from '../../database/admin-schema.js'

export const administratorRoles: AdministratorRole[] = ['super_admin', 'it_admin', 'sales_admin', 'finance_admin', 'inventory_admin', 'marketing_admin', 'content_admin', 'second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator']
export const marketplaceAdministratorRoles: ReadonlySet<AdministratorRole> = new Set(['second_hand_admin', 'seller_support_admin', 'marketplace_finance_admin', 'marketplace_moderator'])

export function isMarketplaceRoleNumberActivation(input: { role: AdministratorRole | null; status: string; roleNumber: string | null; emailVerifiedAt: Date | null; password: string }): boolean {
  return input.status === 'pending'
    && input.emailVerifiedAt === null
    && input.roleNumber !== null
    && input.password === input.roleNumber
    && input.role !== null
    && marketplaceAdministratorRoles.has(input.role)
}

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
  'finance.manage_reconciliation',
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
  'marketplace.dashboard.read',
  'marketplace.listings.read',
  'marketplace.listings.manage',
  'marketplace.categories.manage',
  'marketplace.finance.read',
  'marketplace.finance.reconcile',
  'marketplace.support.manage',
  'marketplace.moderation.manage',
  'marketplace.settings.manage',
] as const

export type AdministratorPermission = typeof administratorPermissions[number]

export const defaultAdministratorPermissions: Record<AdministratorRole, ReadonlySet<AdministratorPermission>> = {
  super_admin: new Set(administratorPermissions),
  it_admin: new Set(['administrators.view', 'audit.view', 'it.view_operations', 'it.manage_monitoring']),
  sales_admin: new Set(['sales.view', 'sales.manage_orders', 'sales.manage_customers', 'sales.manage_products', 'sales.manage_catalogue', 'application.manage_settings', 'audit.view']),
  finance_admin: new Set(['finance.view', 'finance.view_transactions', 'finance.manage_reconciliation', 'finance.manage_refunds', 'finance.manage_expenses', 'finance.manage_settings', 'audit.view']),
  inventory_admin: new Set(['inventory.dashboard.view', 'inventory.stock.view', 'inventory.stock.adjust', 'inventory.stock.movements.view', 'inventory.suppliers.view', 'inventory.suppliers.manage', 'inventory.purchase_orders.view', 'inventory.purchase_orders.create', 'inventory.purchase_orders.approve', 'inventory.receiving.manage', 'inventory.fulfillment.view', 'inventory.fulfillment.manage', 'inventory.returns.view', 'inventory.returns.approve', 'inventory.reports.view', 'inventory.reports.export', 'inventory.audit.view', 'inventory.settings.manage', 'inventory.manage_stock', 'inventory.manage_suppliers', 'inventory.manage_fulfilment', 'audit.view']),
  marketing_admin: new Set(['marketing.dashboard.view', 'marketing.campaigns.view', 'marketing.campaigns.create', 'marketing.campaigns.edit', 'marketing.campaigns.publish', 'marketing.promotions.view', 'marketing.promotions.manage', 'marketing.coupons.view', 'marketing.coupons.manage', 'marketing.audiences.view', 'marketing.audiences.manage', 'marketing.email.view', 'marketing.email.create', 'marketing.notifications.manage', 'marketing.content.manage', 'marketing.analytics.view', 'marketing.reports.export', 'marketing.audit.view', 'marketing.settings.manage', 'marketing.manage_campaigns', 'marketing.manage_promotions', 'audit.view']),
  content_admin: new Set(['content.manage_products', 'content.manage_categories', 'content.manage_content', 'audit.view']),
  second_hand_admin: new Set(['marketplace.dashboard.read', 'marketplace.listings.read', 'marketplace.listings.manage', 'marketplace.categories.manage', 'marketplace.moderation.manage', 'audit.view']),
  seller_support_admin: new Set(['marketplace.dashboard.read', 'marketplace.listings.read', 'marketplace.support.manage', 'audit.view']),
  marketplace_finance_admin: new Set(['marketplace.dashboard.read', 'marketplace.finance.read', 'marketplace.finance.reconcile', 'audit.view']),
  marketplace_moderator: new Set(['marketplace.dashboard.read', 'marketplace.listings.read', 'marketplace.moderation.manage', 'marketplace.support.manage', 'audit.view']),
}

export function hasAdministratorPermission(role: AdministratorRole | null | undefined, permission: AdministratorPermission) {
  return Boolean(role && defaultAdministratorPermissions[role]?.has(permission))
}

export function rolePrefix(role: AdministratorRole) {
  return ({ super_admin: 'SUPER', it_admin: 'IT', sales_admin: 'SALES', finance_admin: 'FIN', inventory_admin: 'INV', marketing_admin: 'MKT', content_admin: 'CONTENT', second_hand_admin: 'SH', seller_support_admin: 'SS', marketplace_finance_admin: 'MF', marketplace_moderator: 'MM' })[role]
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
    second_hand_admin: '/marketplace-admin/dashboard',
    seller_support_admin: '/marketplace-admin/support',
    marketplace_finance_admin: '/marketplace-admin/finance',
    marketplace_moderator: '/marketplace-admin/moderation',
  })[role]
}

export function requiredAdministratorRole(requestPath: string, expectedRole?: AdministratorRole) {
  const loginRoles: Record<string, AdministratorRole> = {
    '/login': 'sales_admin',
    '/super-admin/login': 'super_admin',
    '/finance-admin/login': 'finance_admin',
    '/inventory-admin/login': 'inventory_admin',
    '/marketing-admin/login': 'marketing_admin',
    '/content-admin/login': 'content_admin',
  }
  return loginRoles[requestPath] ?? expectedRole
}
