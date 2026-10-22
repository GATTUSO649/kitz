import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: './server/src/database/schema.ts',
  out: './server/src/database/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'mysql://kitculture:change-me@127.0.0.1:3306/kitculture' },
})