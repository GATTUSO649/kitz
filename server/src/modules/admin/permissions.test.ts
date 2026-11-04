import assert from 'node:assert/strict'
import test from 'node:test'
import { administratorPermissions, defaultAdministratorPermissions, requiredAdministratorRole } from './administration.js'
import { administratorPermissionsForRoute, hasAnyPermission, hasDedicatedAdministratorGuard, projectDashboardForRole } from './permission-routes.js'
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
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('PATCH', '/products/15') ?? []), true)
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('PATCH', '/orders/42/status') ?? []), true)
  assert.equal(hasAnyPermission(sales, administratorPermissionsForRoute('GET', '/payments') ?? []), false)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('GET', '/payments') ?? []), true)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('PATCH', '/orders/42/status') ?? []), false)
  assert.equal(hasAnyPermission(finance, administratorPermissionsForRoute('POST', '/expenses') ?? []), true)
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

test('portal login requirement comes from the requested server route', () => {
  assert.equal(requiredAdministratorRole('/super-admin/login'), 'super_admin')
  assert.equal(requiredAdministratorRole('/login', 'finance_admin'), 'finance_admin')
  assert.equal(requiredAdministratorRole('/login'), undefined)
})
