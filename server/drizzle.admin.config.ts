import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/admin-schema.ts',
  out: './server/src/database/admin-migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? process.env.ADMIN_DATABASE_URL ?? 'mysql://root@127.0.0.1:3306/railway',
  },
})
