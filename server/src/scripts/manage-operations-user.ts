import { hash } from 'bcryptjs'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { adminDb, adminPool } from '../config/database.js'
import { bcryptPasswordSchema } from '../config/password-policy.js'
import { operationsAuditEvents, operationsSessions, operationsUsers } from '../database/admin-schema.js'

async function main() {
  const action = process.argv[2]
  const email = process.env.OPERATIONS_EMAIL?.trim().toLowerCase()
  const fullName = process.env.OPERATIONS_NAME?.trim()
  const password = process.env.OPERATIONS_PASSWORD
  if (!adminDb) throw new Error('Set DATABASE_URL before managing operations accounts.')
  if (!['create', 'disable', 'enable', 'reset-password', 'bootstrap-super-admin'].includes(action) || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: set OPERATIONS_EMAIL and run npm run operations:user -- <create|disable|enable|reset-password|bootstrap-super-admin>. Create also requires OPERATIONS_NAME and OPERATIONS_PASSWORD; reset-password requires OPERATIONS_PASSWORD.')
  }

  if (action === 'bootstrap-super-admin') {
    const approvedEmail = process.env.OPERATIONS_BOOTSTRAP_EMAIL?.trim().toLowerCase()
    if (process.env.OPERATIONS_BOOTSTRAP_APPROVED !== 'YES' || approvedEmail !== email) {
      throw new Error('Bootstrap denied. Set explicit approval and an exact matching OPERATIONS_BOOTSTRAP_EMAIL for this one-time action.')
    }
    const [user] = await adminDb.select({ id: operationsUsers.id, disabledAt: operationsUsers.disabledAt }).from(operationsUsers).where(eq(operationsUsers.email, email)).limit(1)
    if (!user || user.disabledAt) throw new Error('Bootstrap target must be an existing enabled operations account.')
    await adminDb.transaction(async (transaction) => {
      await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtext('kitculture.operations.super_admin.bootstrap'))`)
      const [{ total }] = await transaction.select({ total: count() }).from(operationsUsers)
        .where(and(eq(operationsUsers.role, 'super_admin'), isNull(operationsUsers.disabledAt)))
      if (Number(total) > 0) throw new Error('An active Operations Super Admin already exists.')
      await transaction.update(operationsUsers).set({ role: 'super_admin' })
        .where(and(eq(operationsUsers.id, user.id), isNull(operationsUsers.disabledAt)))
      await transaction.insert(operationsAuditEvents).values({
        actorOperationsUserId: user.id,
        actorType: 'provisioning_cli',
        action: 'operations.super_admin_bootstrapped',
        targetType: 'operations_user',
        targetId: String(user.id),
        details: JSON.stringify({ email }),
      })
    })
    console.info(`One-time Operations Super Admin bootstrapped for ${email}. Remove the bootstrap approval variables now.`)
    return
  }

  if (action === 'create' || action === 'reset-password') {
    const passwordIsValid = bcryptPasswordSchema(14).safeParse(password).success
    if (!passwordIsValid || (action === 'create' && (!fullName || fullName.length < 2 || fullName.length > 160))) {
      throw new Error('Create requires OPERATIONS_NAME (2-160 characters); create and reset-password require OPERATIONS_PASSWORD (14-72 UTF-8 bytes).')
    }
    const passwordHash = await hash(password!, 12)
    if (action === 'create') {
      const [existing] = await adminDb.select({ id: operationsUsers.id }).from(operationsUsers).where(eq(operationsUsers.email, email)).limit(1)
      if (existing) throw new Error('That operations email already exists. Use enable to reactivate a disabled account.')
      const [{ id }] = await adminDb.transaction(async (transaction) => {
        const [created] = await transaction.insert(operationsUsers).values({ email, fullName: fullName!, passwordHash }).returning({ id: operationsUsers.id })
        await transaction.insert(operationsAuditEvents).values({
          actorOperationsUserId: null,
          actorType: 'provisioning_cli',
          action: 'operations_user.created',
          targetType: 'operations_user',
          targetId: String(created.id),
          details: JSON.stringify({ email }),
        })
        return [created]
      })
      console.info(`Independent operations account created for ${email} (id ${id}). Remove OPERATIONS_PASSWORD from the environment now.`)
      return
    }

    const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email })
      .from(operationsUsers).where(eq(operationsUsers.email, email)).limit(1)
    if (!user) throw new Error('An operations account with that email was not found.')
    await adminDb.transaction(async (transaction) => {
      await transaction.update(operationsUsers).set({ passwordHash }).where(eq(operationsUsers.id, user.id))
      await transaction.delete(operationsSessions).where(eq(operationsSessions.operationsUserId, user.id))
      await transaction.insert(operationsAuditEvents).values({
        actorOperationsUserId: null,
        actorType: 'provisioning_cli',
        action: 'operations_user.password_reset',
        targetType: 'operations_user',
        targetId: String(user.id),
        details: JSON.stringify({ email }),
      })
    })
    console.info(`Independent operations password reset for ${email}; all existing sessions were revoked. Remove OPERATIONS_PASSWORD from the environment now.`)
    return
  }

  const [user] = await adminDb.select({ id: operationsUsers.id, email: operationsUsers.email })
    .from(operationsUsers).where(eq(operationsUsers.email, email)).limit(1)
  if (!user) throw new Error('An operations account with that email was not found.')
  await adminDb.transaction(async (transaction) => {
    await transaction.update(operationsUsers).set({ disabledAt: action === 'disable' ? new Date() : null })
      .where(eq(operationsUsers.id, user.id))
    if (action === 'disable') await transaction.delete(operationsSessions).where(eq(operationsSessions.operationsUserId, user.id))
    await transaction.insert(operationsAuditEvents).values({
      actorOperationsUserId: null,
      actorType: 'provisioning_cli',
      action: `operations_user.${action}d`,
      targetType: 'operations_user',
      targetId: String(user.id),
      details: JSON.stringify({ email }),
    })
  })
  console.info(`Independent operations account ${action}d: ${email}.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Operations account update failed.')
  process.exitCode = 1
} finally {
  await adminPool?.end()
}