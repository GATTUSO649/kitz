import 'dotenv/config'
import { and, count, eq, isNull } from 'drizzle-orm'
import { adminDb, adminPool } from '../config/database.js'
import { adminAuditLogs, adminUsers, operationsAuditEvents, operationsOperators } from '../database/admin-schema.js'

async function main() {
  const [action, targetEmailArg, extraArgument] = process.argv.slice(2)
  const targetEmail = targetEmailArg?.trim().toLowerCase()
  const approvedEmail = process.env.IT_ACCESS_BOOTSTRAP_EMAIL?.trim().toLowerCase()

  if (!adminDb || !adminPool) throw new Error('DATABASE_URL must be configured.')
  if (action !== 'bootstrap-super-admin' || !targetEmail || extraArgument) {
    throw new Error('Set IT_ACCESS_BOOTSTRAP_APPROVED=YES and IT_ACCESS_BOOTSTRAP_EMAIL, then run npm run it:access -- bootstrap-super-admin <same-admin-email>.')
  }
  if (process.env.IT_ACCESS_BOOTSTRAP_APPROVED !== 'YES' || approvedEmail !== targetEmail) {
    throw new Error('Bootstrap denied. Set explicit approval and an exact matching administrator email in the one-shot environment.')
  }

  const [admin] = await adminDb.select({ id: adminUsers.id, emailVerifiedAt: adminUsers.emailVerifiedAt })
    .from(adminUsers).where(eq(adminUsers.email, targetEmail)).limit(1)
  if (!admin?.emailVerifiedAt) throw new Error('Bootstrap account must be a verified administrator.')
  const [{ total }] = await adminDb.select({ total: count() }).from(operationsOperators)
    .where(and(eq(operationsOperators.role, 'super_admin'), isNull(operationsOperators.revokedAt)))
  if (total !== 0) throw new Error('An active IT super-admin already exists; use authenticated IT access management.')
  await adminDb.transaction(async (transaction) => {
    const [created] = await transaction.insert(operationsOperators).values({
      adminUserId: admin.id,
      grantedByAdminUserId: admin.id,
      role: 'super_admin',
      grantedAt: new Date(),
      revokedAt: null,
      revokedByAdminUserId: null,
    }).onConflictDoNothing({ target: operationsOperators.adminUserId })
      .returning({ adminUserId: operationsOperators.adminUserId })
    if (!created) throw new Error('Bootstrap account already has an IT grant row; review it before proceeding.')
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: admin.id,
      actorType: 'admin',
      action: 'it_access.bootstrap',
      targetType: 'admin_user',
      targetId: String(admin.id),
      details: JSON.stringify({ role: 'super_admin' }),
    })
    await transaction.insert(adminAuditLogs).values({
      adminUserId: admin.id,
      action: 'it_access.bootstrap',
      targetType: 'admin_user',
      targetId: String(admin.id),
    })
  })
  console.info('One-time IT super-admin grant created and audited. Remove the bootstrap environment values now.')
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'IT access update failed.')
  process.exitCode = 1
} finally {
  await adminPool?.end()
}