import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

if (process.argv.some((argument) => argument === 'migrate')) {
  throw new Error('Legacy MySQL administrator migrations are disabled. Use the approved PostgreSQL Admin migration workflow.')
}

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/admin-schema.mysql.ts',
  out: './server/src/database/admin-migrations',
})
