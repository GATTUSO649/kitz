import 'dotenv/config'
import { adminPool } from '../src/config/database.ts'

if (!adminPool) {
  console.error(JSON.stringify({ configured: false, message: 'ADMIN_DATABASE_URL is not configured.' }))
  process.exitCode = 1
} else {
  try {
    const relations = await adminPool.query(`
      SELECT
        to_regclass('public.waf_ip_policies') AS waf_ip_policies,
        to_regclass('public.admin_biometric_recovery_requests') AS biometric_recovery_requests
    `)
    const ledger = await adminPool.query(`
      SELECT id, hash, created_at
      FROM public.__drizzle_admin_migrations
      ORDER BY id DESC
      LIMIT 10
    `)
    console.info(JSON.stringify({ configured: true, relations: relations.rows[0], ledger: ledger.rows }, null, 2))
  } catch (error) {
    console.error(JSON.stringify({ configured: true, error: error instanceof Error ? error.message : 'Migration verification failed.' }))
    process.exitCode = 1
  } finally {
    await adminPool.end()
  }
}
