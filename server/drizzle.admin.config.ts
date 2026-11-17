import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import { areSameDatabaseTarget, databaseTargetIdentity } from './src/config/database-target.js'
import { createAdminMigrationSslOptions } from './src/config/postgres-ssl.mjs'

const adminDatabaseUrl = process.env.ADMIN_MIGRATION_DATABASE_URL?.trim()
const runtimeAdminDatabaseUrl = process.env.ADMIN_DATABASE_URL?.trim()
const isGenerateCommand = process.argv.some((argument) => argument === 'generate')

if (!adminDatabaseUrl && !isGenerateCommand) {
	throw new Error('ADMIN_MIGRATION_DATABASE_URL is required for administrator schema migrations.')
}
if (!runtimeAdminDatabaseUrl && !isGenerateCommand) {
	throw new Error('ADMIN_DATABASE_URL is required to verify the Admin migration project identity.')
}

const connectionUrl = adminDatabaseUrl ? new URL(adminDatabaseUrl) : null
if (connectionUrl && !['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
	throw new Error('ADMIN_MIGRATION_DATABASE_URL must use the PostgreSQL protocol.')
}
if (adminDatabaseUrl && process.env.DATABASE_URL && areSameDatabaseTarget(adminDatabaseUrl, process.env.DATABASE_URL)) {
	throw new Error('The Admin migration target must be a different database project from DATABASE_URL.')
}
if (adminDatabaseUrl && !isGenerateCommand) {
	const expectedTarget = process.env.ADMIN_MIGRATION_TARGET_IDENTITY?.trim()
	if (!expectedTarget || databaseTargetIdentity(adminDatabaseUrl) !== expectedTarget) {
		throw new Error('Set ADMIN_MIGRATION_TARGET_IDENTITY to the independently verified Admin database identity.')
	}
	if (process.env.ADMIN_MIGRATION_APPROVED !== 'YES'
		|| process.env.ADMIN_BACKUP_VERIFIED !== 'YES'
		|| process.env.ADMIN_STAGING_VERIFIED !== 'YES') {
		throw new Error('Admin migrations require explicit approval, a verified backup, and successful staging verification.')
	}
}

if (connectionUrl) {
	for (const key of ['sslmode', 'ssl', 'sslcert', 'sslkey', 'sslrootcert']) connectionUrl.searchParams.delete(key)
}

export default defineConfig({
	dialect: 'postgresql',
	schema: './server/src/database/admin-schema.ts',
	out: './server/src/database/admin-postgres-migrations',
	migrations: {
		table: '__drizzle_admin_migrations',
		schema: 'public',
	},
	...(connectionUrl && !isGenerateCommand ? {
		dbCredentials: {
			host: connectionUrl.hostname,
			port: Number(connectionUrl.port || 5432),
			user: decodeURIComponent(connectionUrl.username),
			password: decodeURIComponent(connectionUrl.password),
			database: decodeURIComponent(connectionUrl.pathname.slice(1)),
			ssl: createAdminMigrationSslOptions({
				migrationUrl: adminDatabaseUrl,
				runtimeAdminUrl: runtimeAdminDatabaseUrl,
				migrationCaFile: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE,
				migrationCaContents: process.env.ADMIN_MIGRATION_SUPABASE_CA_CERT,
				adminCaFile: process.env.ADMIN_SUPABASE_CA_CERT_FILE,
				adminCaContents: process.env.ADMIN_SUPABASE_CA_CERT,
				requireCa: process.env.NODE_ENV === 'production',
			}),
		},
	} : {}),
})
