import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

const databaseUrl = process.env.MYSQL_SOURCE_URL ?? process.env.MYSQL_URL ?? process.env.MYSQL_URI ?? process.env.MYSQL_PUBLIC_URL
if (!databaseUrl || !databaseUrl.startsWith('mysql://')) throw new Error('Set MYSQL_SOURCE_URL or a MYSQL_URL before running MySQL rollback migrations.')

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/schema.mysql.ts',
  out: './server/src/database/migrations',
  dbCredentials: { url: databaseUrl },
})