import { hash } from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { adminDb, adminPool } from '../config/database.js'
import { adminUsers } from '../database/admin-schema.js'

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  const fullName = process.env.ADMIN_NAME?.trim()
  const password = process.env.ADMIN_PASSWORD
  if (!adminDb) throw new Error('Set ADMIN_DATABASE_URL before provisioning an administrator.')
  if (!email || !fullName || !password || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || fullName.length < 2 || password.length < 14 || password.length > 128) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_NAME, and a unique ADMIN_PASSWORD of 14 to 128 characters.')
  }

  const [existing] = await adminDb.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.email, email)).limit(1)
  if (existing) throw new Error('That email already has an account. Use a new, controlled administrator email.')

  const passwordHash = await hash(password, 12)
  const result = await adminDb.transaction(async (transaction) => {
    const [created] = await transaction.insert(adminUsers).values({
      email,
      fullName,
      passwordHash,
      emailVerifiedAt: new Date(),
    }).$returningId()
    return created.id
  })
  console.info(`Administrator provisioned: ${email} (user ${result}). Remove ADMIN_PASSWORD from the environment now.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Administrator provisioning failed.')
  process.exitCode = 1
} finally {
  await adminPool?.end()
}
