import 'dotenv/config'
import mysql from 'mysql2/promise'

const databaseUrl = process.env.ADMIN_DATABASE_URL
if (!databaseUrl) throw new Error('Set ADMIN_DATABASE_URL before creating the administrator database.')

const target = new URL(databaseUrl)
const databaseName = target.pathname.slice(1)
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error('ADMIN_DATABASE_URL must use a simple database name.')

const connection = await mysql.createConnection({
  host: target.hostname,
  port: target.port ? Number(target.port) : 3306,
  user: decodeURIComponent(target.username),
  password: decodeURIComponent(target.password),
})
try {
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  console.info(`Administrator database "${databaseName}" exists.`)
} finally {
  await connection.end()
}
