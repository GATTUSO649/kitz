import assert from 'node:assert/strict'
import test from 'node:test'
import { administratorPermissions, administratorPortal, defaultAdministratorPermissions, requiredAdministratorRole } from './administration.js'
import { administratorPermissionsForRoute, administratorPortalPermission, hasAnyPermission, hasDedicatedAdministratorGuard, projectDashboardForRole } from './permission-routes.js'
import { resolveAdministratorPermissions, validatePermissionSelection } from './permissions.js'

test('permission resolver preserves default access until a role is configured', () => {
  const resolved = resolveAdministratorPermissions('sales_admin', [])
  assert.deepEqual([...resolved].sort(), [...defaultAdministratorPermissions.sales_admin].sort())
})

test('configured role permissions replace defaults and user overrides are applied', () => {
  const resolved = resolveAdministratorPermissions('sales_admin', ['sales.view'], [
    { permission: 'sales.manage_orders', granted: true },
    { permission: 'sales.view', granted: false },
    { permission: 'not.a.real.permission', granted: true },
  ])
  assert.deepEqual([...resolved], ['sales.manage_orders'])
})

test('Super Admin permission set is immutable and always complete', () => {
  const resolved = resolveAdministratorPermissions('super_admin', [], [{ permission: 'administrators.manage', granted: false }])
  assert.deepEqual([...resolved].sort(), [...administratorPermissions].sort())
})

test('permission selections reject unknown and duplicate permission names', () => {
  assert.equal(validatePermissionSelection(['sales.view']), true)
  assert.equal(validatePermissionSelection(['sales.view', 'sales.view']), false)
  assert.equal(validatePermissionSelection(['unknown.permission']), false)
})

test('route permission matrix preserves Sales ownership and protects Finance boundaries', () => {
  const sales = defaultAdministratorPermissions.sales_admin
  const finance = defaultAdministratorPermissions.finance_admin
  assert.equal(finance.has('finance.manage_settings'), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('GET', '/finance/settings') ?? []), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('PATCH', '/finance/settings') ?? []), true)
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('PATCH', '/products/15') ?? []), true)
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('PATCH', '/orders/42/status') ?? []), true)
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('GET', '/payments') ?? []), false)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('GET', '/payments') ?? []), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('GET', '/dashboard') ?? []), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('PATCH', '/orders/42/status') ?? []), false)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('POST', '/expenses') ?? []), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('POST', '/finance/reconciliation') ?? []), true)
  assert.equal(hasAnyPermission(defaultAdministratorPermissions.sales_admin, administratorPermissionsForRoute('POST', '/finance/reconciliation') ?? []), false)
})

test('Inventory Admin permissions cover stock, movement, and fulfillment boundaries', () => {
  const inventory = defaultAdministratorPermissions.inventory_admin
  assert.equal(hasAnyPermission(inventory, administratorPermissionsForRoute('GET', '/dashboard') ?? []), true)
  assert.equal(hasAnyPermission(inventory, administratorPermissionsForRoute('GET', '/products') ?? []), true)
  assert.equal(hasAnyPermission(inventory, administratorPermissionsForRoute('POST', '/products/15/variants/22/stock') ?? []), true)
  assert.equal(hasAnyPermission(inventory, administratorPermissionsForRoute('GET', '/inventory/movements') ?? []), true)
  assert.equal(hasAnyPermission(inventory, administratorPermissionsForRoute('GET', '/orders') ?? []), true)
  assert.equal(hasAnyPermission(defaultAdministratorPermissions.finance_admin, administratorPermissionsForRoute('POST', '/products/15/variants/22/stock') ?? []), false)
  assert.deepEqual(administratorPermissionsForRoute('POST', '/inventory/purchase-orders'), ['inventory.purchase_orders.create'])
  assert.deepEqual(administratorPermissionsForRoute('PATCH', '/inventory/purchase-orders/15'), ['inventory.purchase_orders.approve'])
  assert.deepEqual(administratorPermissionsForRoute('POST', '/inventory/purchase-orders/15/receive'), ['inventory.receiving.manage'])
})

test('Marketing Admin permissions cover campaign notification boundaries', () => {
  const marketing = defaultAdministratorPermissions.marketing_admin
  assert.equal(hasAnyPermission(marketing, administratorPermissionsForRoute('GET', '/notifications') ?? []), true)
  assert.equal(hasAnyPermission(marketing, administratorPermissionsForRoute('POST', '/notifications') ?? []), true)
  assert.equal(hasAnyPermission(defaultAdministratorPermissions.finance_admin, administratorPermissionsForRoute('POST', '/notifications') ?? []), false)
  assert.deepEqual(administratorPermissionsForRoute('POST', '/marketing/email-campaigns'), ['marketing.email.send'])
  assert.equal(hasAnyPermission(marketing, administratorPermissionsForRoute('POST', '/marketing/email-campaigns') ?? []), false)
})

test('unclassified business routes are not assigned an accidental permission', () => {
  assert.equal(administratorPermissionsForRoute('POST', '/unreviewed-route'), null)
})

test('only self-profile, Operations, and role portal endpoints bypass the common route map', () => {
  assert.equal(hasDedicatedAdministratorGuard('/me'), true)
  assert.equal(hasDedicatedAdministratorGuard('/it/overview'), true)
  assert.equal(hasDedicatedAdministratorGuard('/portal/finance_admin'), true)
  assert.equal(hasDedicatedAdministratorGuard('/settings'), false)
  assert.equal(hasDedicatedAdministratorGuard('/unreviewed-route'), false)
})

test('Sales dashboard projection does not expose finance or inventory aggregates', () => {
  const data = projectDashboardForRole('sales_admin', {
    totalOrders: 12,
    totalCustomers: 25,
    paidRevenue: '5000.00',
    paidOrderCount: 9,
    inventoryUnits: 40,
    lowStockVariants: 2,
    revenueTrend: [{ date: '2026-11-01', revenue: '1000.00' }],
    recentOrders: [{ orderNumber: 'KC-1' }],
  })
  assert.deepEqual(data, { totalOrders: 12, totalCustomers: 25, recentOrders: [{ orderNumber: 'KC-1' }] })
})

test('dashboard projections honor stored permission overrides', () => {
  const data = projectDashboardForRole('finance_admin', {
    paidRevenue: '5000.00',
    totalOrders: 12,
  }, new Set(['sales.view']))
  assert.deepEqual(data, { totalOrders: 12 })
})

test('portal summary endpoints require the role-specific dashboard permission', () => {
  assert.equal(administratorPortalPermission('finance_admin'), 'finance.view')
  assert.equal(administratorPortalPermission('inventory_admin'), 'inventory.dashboard.view')
  assert.equal(administratorPortalPermission('unknown_role'), null)
})

test('administrator portal destination and login role come from server policy', () => {
  assert.equal(administratorPortal('sales_admin'), '/sales-admin/dashboard')
  assert.equal(requiredAdministratorRole('/super-admin/login'), 'super_admin')
  assert.equal(requiredAdministratorRole('/login', 'super_admin'), 'sales_admin')
  assert.equal(requiredAdministratorRole('/finance-admin/login'), 'finance_admin')
  assert.equal(requiredAdministratorRole('/content-admin/login'), 'content_admin')
  assert.equal(requiredAdministratorRole('/login'), 'sales_admin')
})
