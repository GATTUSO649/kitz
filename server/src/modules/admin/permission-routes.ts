import { defaultAdministratorPermissions, type AdministratorPermission } from './administration.js'

type PermissionRule = {
  path: RegExp
  read: readonly AdministratorPermission[]
  write?: readonly AdministratorPermission[]
}

const rules: PermissionRule[] = [
  { path: /^\/dashboard\/?$/, read: ['analytics.system', 'sales.view', 'finance.view'] },
  { path: /^\/finance\/refunds(?:\/|$)/, read: ['finance.manage_refunds'], write: ['finance.manage_refunds'] },
  { path: /^\/finance\/reconciliation\/?$/, read: ['finance.view'], write: ['finance.view'] },
  { path: /^\/(?:payments)(?:\/|$)/, read: ['finance.view_transactions'] },
  { path: /^\/reports\/financial\/?$/, read: ['finance.view'] },
  { path: /^\/finance\/settings\/?$/, read: ['finance.view'], write: ['finance.manage_settings'] },
  { path: /^\/expenses(?:\/|$)/, read: ['finance.view'], write: ['finance.manage_expenses'] },
  { path: /^\/inventory(?:\/|$)/, read: ['inventory.stock.movements.view', 'inventory.manage_stock'], write: ['inventory.stock.adjust', 'inventory.manage_stock'] },
  { path: /^\/inventory\/suppliers(?:\/|$)/, read: ['inventory.suppliers.view', 'inventory.manage_suppliers'], write: ['inventory.suppliers.manage', 'inventory.manage_suppliers'] },
  { path: /^\/inventory\/purchase-orders(?:\/|$)/, read: ['inventory.purchase_orders.view'], write: ['inventory.purchase_orders.create', 'inventory.purchase_orders.approve'] },
  { path: /^\/inventory\/returns(?:\/|$)/, read: ['inventory.returns.view'], write: ['inventory.returns.approve'] },
  { path: /^\/products\/[^/]+\/variants\/[^/]+\/stock\/?$/, read: ['inventory.stock.view', 'inventory.manage_stock'], write: ['inventory.stock.adjust', 'inventory.manage_stock'] },
  { path: /^\/(?:leagues|jersey-categories)(?:\/|$)/, read: ['sales.manage_catalogue', 'content.manage_categories'], write: ['sales.manage_catalogue', 'content.manage_categories'] },
  { path: /^\/products(?:\/|$)/, read: ['sales.manage_products', 'content.manage_products', 'inventory.stock.view'], write: ['sales.manage_products', 'content.manage_products'] },
  { path: /^\/categories(?:\/|$)/, read: ['sales.manage_catalogue', 'content.manage_categories'], write: ['sales.manage_catalogue', 'content.manage_categories'] },
  { path: /^\/(?:football|catalogue-options)(?:\/|$)/, read: ['sales.manage_catalogue', 'content.manage_categories'], write: ['sales.manage_catalogue', 'content.manage_categories'] },
  { path: /^\/homepage(?:\/|$)/, read: ['sales.manage_catalogue', 'content.manage_content'], write: ['sales.manage_catalogue', 'content.manage_content'] },
  { path: /^\/orders\/[^/]+\/status\/?$/, read: ['sales.view', 'inventory.manage_fulfilment'], write: ['sales.manage_orders', 'inventory.manage_fulfilment'] },
  { path: /^\/orders(?:\/|$)/, read: ['sales.view', 'inventory.fulfillment.view', 'inventory.manage_fulfilment'], write: ['sales.manage_orders', 'inventory.fulfillment.manage', 'inventory.manage_fulfilment'] },
  { path: /^\/guest-orders(?:\/|$)/, read: ['sales.view'], write: ['sales.manage_orders'] },
  { path: /^\/(?:customers|support)(?:\/|$)/, read: ['sales.manage_customers'], write: ['sales.manage_customers'] },
  { path: /^\/delivery\/zones(?:\/|$)/, read: ['sales.manage_orders', 'inventory.manage_fulfilment'], write: ['sales.manage_orders', 'inventory.manage_fulfilment'] },
  { path: /^\/notifications(?:\/|$)/, read: ['sales.manage_customers', 'marketing.notifications.manage', 'marketing.campaigns.view', 'marketing.manage_campaigns'], write: ['sales.manage_customers', 'marketing.notifications.manage', 'marketing.campaigns.publish', 'marketing.manage_campaigns'] },
  { path: /^\/marketing\/coupons(?:\/|$)/, read: ['marketing.coupons.view'], write: ['marketing.coupons.manage'] },
  { path: /^\/marketing\/audiences\/?$/, read: ['marketing.audiences.view'] },
  { path: /^\/marketing\/email-campaigns(?:\/|$)/, read: ['marketing.email.view'], write: ['marketing.email.create'] },
  { path: /^\/settings\/?$/, read: ['application.manage_settings'], write: ['application.manage_settings'] },
  { path: /^\/audit\/?$/, read: ['audit.view', 'inventory.audit.view', 'marketing.audit.view'] },
]

export function administratorPermissionsForRoute(method: string, path: string): readonly AdministratorPermission[] | null {
  const rule = rules.find((candidate) => candidate.path.test(path))
  if (!rule) return null
  return method === 'GET' || method === 'HEAD' ? rule.read : rule.write ?? rule.read
}

export function hasAnyPermission(granted: ReadonlySet<AdministratorPermission>, required: readonly AdministratorPermission[]) {
  return required.some((permission) => granted.has(permission))
}

export function hasDedicatedAdministratorGuard(path: string) {
  return path === '/me' || path.startsWith('/it/') || /^\/portal\/(?:super_admin|it_admin|sales_admin|finance_admin|inventory_admin|marketing_admin|content_admin)$/.test(path)
}

const salesDashboardFields = [
  'period', 'from', 'to', 'totalOrders', 'pendingOrders', 'totalCustomers', 'newCustomers', 'returningCustomers',
  'totalProducts', 'recentOrders', 'bestSellers', 'worstSellers', 'salesByCategory', 'salesByLocation',
] as const

export function projectDashboardForRole(role: string | null, data: Record<string, unknown>, granted?: ReadonlySet<AdministratorPermission>) {
  if (role === 'super_admin') return data
  const permissions = granted ?? (role && role in defaultAdministratorPermissions ? defaultAdministratorPermissions[role as keyof typeof defaultAdministratorPermissions] : new Set<AdministratorPermission>())
  const fields = new Set<string>(['period', 'from', 'to'])
  if (permissions.has('sales.view')) for (const field of salesDashboardFields) fields.add(field)
  if (permissions.has('finance.view')) for (const field of ['paidRevenue', 'paidOrderCount', 'averageOrderValue', 'paidPayments', 'revenueTrend']) fields.add(field)
  if (permissions.has('inventory.manage_stock')) for (const field of ['inventoryUnits', 'lowStockVariants', 'outOfStockVariants']) fields.add(field)
  return Object.fromEntries([...fields].filter((field) => field in data).map((field) => [field, data[field]]))
}
