import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.MYSQL_SOURCE_URL ?? process.env.ADMIN_MYSQL_URL ?? process.env.MYSQL_URL ?? process.env.MYSQL_PUBLIC_URL
if (!databaseUrl || !databaseUrl.startsWith('mysql://')) throw new Error('Set a MySQL source URL before running administrator rollback migrations.')

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/admin-schema.mysql.ts',
  out: './server/src/database/admin-migrations',
  dbCredentials: {
    url: databaseUrl,
  },
})
