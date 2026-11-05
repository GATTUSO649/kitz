import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

if (!process.env.MARKETPLACE_DATABASE_URL) {
  throw new Error('MARKETPLACE_DATABASE_URL is required for marketplace migrations.')
}
const databaseName = decodeURIComponent(new URL(process.env.MARKETPLACE_DATABASE_URL).pathname.replace(/^\/+/, ''))
if (databaseName !== process.env.MARKETPLACE_DATABASE_NAME || !/(?:^|[_-])marketplace$/i.test(databaseName)) {
  throw new Error('Marketplace migrations require a separately provisioned database whose name ends in marketplace.')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/src/database/schema.ts',
  out: './server/src/database/migrations',
  dbCredentials: { url: process.env.MARKETPLACE_DATABASE_URL },
  strict: true,
  verbose: true,
})