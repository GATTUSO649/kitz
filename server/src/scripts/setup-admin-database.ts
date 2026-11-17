import 'dotenv/config'
import { areSameDatabaseTarget, databaseTargetIdentity } from '../config/database-target.js'

const adminDatabaseUrl = process.env.ADMIN_DATABASE_URL?.trim()
const kitzDatabaseUrl = process.env.DATABASE_URL?.trim()
if (!adminDatabaseUrl) throw new Error('Set ADMIN_DATABASE_URL to the separate Admin Supabase project.')
if (kitzDatabaseUrl && areSameDatabaseTarget(adminDatabaseUrl, kitzDatabaseUrl)) {
  throw new Error('The Admin database must be a separate project from the Kitz database.')
}

console.info(`Separate Admin database configured: ${databaseTargetIdentity(adminDatabaseUrl) ?? 'identity requires manual verification'}.`)
