import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const logIndex = args.indexOf('--log')
const logPath = logIndex >= 0 ? args[logIndex + 1] : undefined
if (logIndex >= 0) args.splice(logIndex, 2)
const separatorIndex = args.indexOf('--')
if (separatorIndex >= 0) args.splice(separatorIndex, 1)
const [command, ...commandArgs] = args
if (!command) throw new Error('Provide a command after --.')

function sanitize(value) {
  let output = value
  const secretValues = [
    process.env.MARKETHUB_PREFLIGHT_DATABASE_URL,
    process.env.MARKETPLACE_DATABASE_URL,
    process.env.MARKETPLACE_MIGRATION_DATABASE_URL,
    process.env.SUPABASE_ACCESS_TOKEN,
    process.env.SUPABASE_DB_PASSWORD,
    process.env.RENDER_API_KEY,
    process.env.MARKETPLACE_DATABASE_CA,
  ].filter((secret) => typeof secret === 'string' && secret.length > 0)
  for (const secret of secretValues) output = output.split(secret).join('[REDACTED]')
  return output
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sbp|eyJ)[A-Za-z0-9._-]{20,}/g, '[REDACTED TOKEN]')
}

const child = spawn(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env, windowsHide: true })
const stdout = []
const stderr = []
child.stdout.on('data', (chunk) => stdout.push(chunk))
child.stderr.on('data', (chunk) => stderr.push(chunk))
child.on('error', (error) => {
  process.stderr.write(`Command could not start: ${sanitize(error.message)}\n`)
  process.exitCode = 1
})
child.on('close', async (code, signal) => {
  const output = sanitize(Buffer.concat(stdout).toString('utf8'))
  const errors = sanitize(Buffer.concat(stderr).toString('utf8'))
  const combined = `${output}${errors ? `${output && !output.endsWith('\n') ? '\n' : ''}${errors}` : ''}`
  process.stdout.write(combined)
  if (logPath) await writeFile(path.resolve(logPath), combined, 'utf8')
  if (signal) {
    process.stderr.write(`Command terminated by signal ${signal}.\n`)
    process.exitCode = 1
  } else {
    process.exitCode = code ?? 1
  }
})