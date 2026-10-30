import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'
import { resolveDatabaseUrl } from './src/config/env.js'

const databaseUrl = resolveDatabaseUrl('DATABASE_URL', ['MYSQL_URL', 'MYSQL_URI', 'MYSQL_PUBLIC_URL'])

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/schema.ts',
  out: './server/src/database/migrations',
  dbCredentials: { url: databaseUrl ?? 'mysql://kitculture:change-me@127.0.0.1:3306/kitculture' },
})