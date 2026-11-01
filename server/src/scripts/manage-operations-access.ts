import { and, eq, isNotNull } from 'drizzle-orm'
import { adminDb, adminPool } from '../config/database.js'
import { adminUsers, operationsAuditEvents, operationsOperators } from '../database/admin-schema.js'

async function main() {
  const action = process.argv[2]
  const email = process.argv[3]?.trim().toLowerCase()
  if (!adminDb) throw new Error('Set DATABASE_URL before managing operations access.')
  if (!['grant', 'revoke'].includes(action) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npm run operations:access -- <grant|revoke> <verified-admin-email>')
  }
  const [admin] = await adminDb.select({ id: adminUsers.id, email: adminUsers.email })
    .from(adminUsers).where(and(eq(adminUsers.email, email), isNotNull(adminUsers.emailVerifiedAt))).limit(1)
  if (!admin) throw new Error('A verified administrator with that email was not found.')

  await adminDb.transaction(async (transaction) => {
    if (action === 'grant') {
      await transaction.insert(operationsOperators).values({ adminUserId: admin.id, grantedByAdminUserId: null })
        .onDuplicateKeyUpdate({ set: { grantedByAdminUserId: null } })
    } else {
      await transaction.delete(operationsOperators).where(eq(operationsOperators.adminUserId, admin.id))
    }
    await transaction.insert(operationsAuditEvents).values({
      actorAdminUserId: null,
      actorType: 'provisioning_cli',
      action: `operator.${action}`,
      targetType: 'administrator',
      targetId: String(admin.id),
      details: JSON.stringify({ email: admin.email }),
    })
  })
  console.info(`Operations access ${action === 'grant' ? 'granted to' : 'revoked from'} ${admin.email}.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operations access update failed.')
  process.exitCode = 1
} finally {
  await adminPool?.end()
}