import assert from 'node:assert/strict'
import test from 'node:test'
import { classifySeverity, redactSensitiveEvidence, runDependencyScanner } from './dependency-scanner.js'
import { getSecurityOverview, listSecurityFindings, startSecurityScan, cancelSecurityScan } from './scanner-engine.js'

test('redacts sensitive scanner evidence without exposing secrets', () => {
  const result = redactSensitiveEvidence({ text: 'password=hunter2', authorization: 'Bearer complete-secret-token' }) as Record<string, unknown>
  assert.equal(result.password, undefined)
  assert.match(String(result.text), /\[REDACTED\]/)
  assert.doesNotMatch(JSON.stringify(result), /hunter2|complete-secret-token/i)
})

test('severity is classified only when npm audit provides a known severity', () => {
  assert.equal(classifySeverity('critical'), 'CRITICAL')
  assert.equal(classifySeverity('moderate'), 'MEDIUM')
  assert.equal(classifySeverity(undefined), null)
  assert.equal(classifySeverity('unexpected'), null)
})

test('scanner engine exposes unsupported modules and does not fabricate coverage', () => {
  const overview = getSecurityOverview()
  assert.equal(overview.score, null)
  assert.equal(overview.coverage.secrets, false)
  assert.equal(overview.coverage.web, false)
})

test('a dependency scan completes and deduplicates repeated vulnerability observations', async () => {
  const scan = await startSecurityScan(['dependency'], process.cwd(), 120_000)
  for (let attempt = 0; attempt < 120 && !scan.completedAt; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.notEqual(scan.status, 'queued')
  assert.notEqual(scan.status, 'running')
  const keys = listSecurityFindings().map((finding) => finding.deduplicationKey)
  assert.equal(keys.length, new Set(keys).size)
})

test('cancel rejects an unknown scan without changing active jobs', () => {
  assert.equal(cancelSecurityScan('not-a-real-scan'), false)
})

test('dependency scanner can execute the fixed npm audit command', async () => {
  const result = await runDependencyScanner({ cwd: process.cwd(), timeoutMs: 120_000 })
  assert.ok(result.summary.scanner === 'npm-audit')
  assert.ok(Array.isArray(result.findings))
})
