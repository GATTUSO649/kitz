import 'dotenv/config'
import { app } from './app.js'
import { marketplaceDatabaseStartupDiagnostic, pool } from './database/connection.js'
import { startMarketplaceEmailWorker } from './modules/email/outbox.js'
import { getMarketplaceEmailProviderStatus } from './modules/email/service.js'
import { startMarketplaceExpiryWorker } from './modules/marketplace/expiry.js'

const port = Number(process.env.PORT || 4001)
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'
const stopEmailWorker = startMarketplaceEmailWorker()
const stopExpiryWorker = startMarketplaceExpiryWorker()
console.info('MarketHub background workers initialized', {
  databaseConfigured: Boolean(pool),
  emailProvider: getMarketplaceEmailProviderStatus(),
  workersEnabled: { marketplaceEmail: Boolean(pool), listingExpiry: Boolean(pool) },
})
const server = app.listen(port, host, () => {
  console.log(`MarketHub platform API listening on ${port}`)
  void marketplaceDatabaseStartupDiagnostic().then((diagnostic) => {
    const log = diagnostic.databaseConnected ? console.info : console.error
    log('MarketHub startup database diagnostic', diagnostic)
  })
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopEmailWorker()
    stopExpiryWorker()
    server.close(() => {
      void pool?.end().finally(() => process.exit(0))
    })
  })
}