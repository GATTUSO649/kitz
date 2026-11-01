import pino from 'pino'
import { env } from './env.js'

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'req.headers.x-kitculture-origin-auth', 'req.url', '*.password', '*.passwordHash', '*.token', '*.phoneNumber'],
  timestamp: pino.stdTimeFunctions.isoTime,
})