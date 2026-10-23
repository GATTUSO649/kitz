import 'dotenv/config'

const databaseUrl = process.env.DATABASE_URL ?? process.env.ADMIN_DATABASE_URL
if (!databaseUrl) throw new Error('Set DATABASE_URL before applying the shared admin schema to the Railway database.')

const target = new URL(databaseUrl)
const databaseName = target.pathname.slice(1)
if (!databaseName || !/^[a-zA-Z0-9_]+$/.test(databaseName)) {
  throw new Error('The database URL must point to a valid MySQL database name.')
}

console.info(`Using the shared application database "${databaseName}" for the admin schema.`)
