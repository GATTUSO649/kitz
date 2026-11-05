import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { database, pool } from '../database/connection.js'
import { marketplaceAdminUsers, marketplaceAuditLogs } from '../database/schema.js'

async function main() {
  if (!database) throw new Error('MARKETPLACE_DATABASE_URL is required.')
  const email = process.env.MARKETPLACE_ADMIN_EMAIL?.trim().toLowerCase()
  const password = process.env.MARKETPLACE_ADMIN_PASSWORD
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Set MARKETPLACE_ADMIN_EMAIL to a valid email address.')
  if (!password || password.length < 14 || Buffer.byteLength(password, 'utf8') > 72) throw new Error('Set a one-time MARKETPLACE_ADMIN_PASSWORD between 14 and 72 UTF-8 bytes.')
  const [existing] = await database.select({ id: marketplaceAdminUsers.id }).from(marketplaceAdminUsers).where(eq(marketplaceAdminUsers.role, 'super_admin')).limit(1)
  if (existing) throw new Error('Marketplace Super Admin is already provisioned; use an authorized admin workflow.')
  const passwordHash = await bcrypt.hash(password, 12)
  await database.transaction(async (transaction) => {
    const [admin] = await transaction.insert(marketplaceAdminUsers).values({ email, passwordHash, role: 'super_admin', active: true }).returning({ id: marketplaceAdminUsers.id })
    if (!admin) throw new Error('Marketplace administrator was not created.')
    await transaction.insert(marketplaceAuditLogs).values({ adminUserId: admin.id, action: 'admin.bootstrap', resourceType: 'admin_user', resourceId: admin.id })
  })
  console.log('Marketplace Super Admin provisioned. Remove the one-time environment values now.')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Marketplace administrator provisioning failed.')
  process.exitCode = 1
}).finally(async () => {
  await pool?.end()
})
