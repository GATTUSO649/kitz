import { app } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { adminPool, pool } from './config/database.js'

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, databaseConfigured: Boolean(pool) }, 'KitCulture API listening')
})

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API')
  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'HTTP server shutdown failed')
    if (pool) await pool.end()
    if (adminPool && adminPool !== pool) await adminPool.end()
    process.exit(error ? 1 : 0)
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))