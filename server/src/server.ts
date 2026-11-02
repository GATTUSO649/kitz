import { app } from './app.js'
import { env } from './config/env.js'
import { logger } from './config/logger.js'
import { adminPool, pool } from './config/database.js'
import { startMonitoringWorker, stopMonitoringWorker } from './modules/operations/monitoring-worker.js'
import { flushMonitoringEvents } from './modules/operations/telemetry-store.js'

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, databaseConfigured: Boolean(pool) }, 'KitCulture API listening')
})
startMonitoringWorker()

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down API')
  const workerShutdown = stopMonitoringWorker()
  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'HTTP server shutdown failed')
    await workerShutdown
    await flushMonitoringEvents()
    if (pool) await pool.end()
    if (adminPool && adminPool !== pool) await adminPool.end()
    process.exit(error ? 1 : 0)
  })
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))