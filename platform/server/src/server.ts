import 'dotenv/config'
import { app } from './app.js'
import { pool } from './database/connection.js'

const port = Number(process.env.PORT || 4001)
const host = process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'
const server = app.listen(port, host, () => {
  console.log(`MarketHub platform API listening on ${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      void pool?.end().finally(() => process.exit(0))
    })
  })
}