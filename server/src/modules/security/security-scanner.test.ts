import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifySeverity, discoverNpmAuditTargets, redactSensitiveEvidence, runDependencyScanner } from './dependency-scanner.js'
import { dependencyScanRecoveryCutoff, nextDailyRunAt } from './scheduled-scanner.js'
import { scanTextForSecrets } from './secret-scanner.js'
import { generateCycloneDxSbom } from './sbom.js'
import { runOsvScanner } from './osv-scanner.js'
import { dependencyScannerAvailability, getSecurityOverview, listSecurityFindings, startSecurityScan, cancelSecurityScan } from './scanner-engine.js'

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

test('dependency scanner availability does not claim health before an executed scan', () => {
  assert.equal(dependencyScannerAvailability('/path/to/npm'), 'not_run')
  assert.equal(dependencyScannerAvailability(''), 'not_configured')
})

test('repository secret findings retain only masked evidence and fingerprints', () => {
  const secret = 'this-is-a-test-secret-value-123456'
  const findings = scanTextForSecrets(`SERVICE_SECRET=${secret}`, 'config/local.env')
  assert.equal(findings.length, 1)
  assert.deepEqual(findings[0].evidence && { ...findings[0].evidence, fingerprint: '[MASKED]' }, {
    ruleId: 'sensitive-assignment',
    line: 1,
    fingerprint: '[MASKED]',
  })
  assert.doesNotMatch(JSON.stringify(findings), new RegExp(secret))
})

test('repository secret scanner suppresses documented placeholders and recognizes private key markers', () => {
  assert.equal(scanTextForSecrets('SERVICE_SECRET=replace-this-secret-value-123456', 'config/example.env').length, 0)
  const findings = scanTextForSecrets('-----BEGIN PRIVATE KEY-----', 'secrets/key.pem')
  assert.equal(findings[0]?.severity, 'HIGH')
  assert.equal(findings[0]?.evidence.ruleId, 'private-key')
})

test('secret scope executes the local repository scanner and reports masked scan metadata', async () => {
  const scan = await startSecurityScan(['secrets'], process.cwd(), 30_000)
  for (let attempt = 0; attempt < 100 && !scan.completedAt; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  assert.equal(scan.status, 'completed')
  assert.equal(scan.modules[0]?.status, 'successful')
  assert.equal(scan.summary.scanner, 'repository-secret-scanner')
  assert.equal(scan.summary.valuesMasked, true)
  assert.ok(Number(scan.summary.scannedFiles) > 0)
})

test('CycloneDX SBOM includes Kitz and MarketHub lockfile projects with resolvable dependencies', () => {
  const bom = generateCycloneDxSbom(process.cwd())
  const components = bom.components as { name?: string; properties?: { name: string; value: string }[]; 'bom-ref': string }[]
  const references = new Set(components.map((component) => component['bom-ref']))
  assert.equal(bom.bomFormat, 'CycloneDX')
  assert.equal(bom.specVersion, '1.5')
  assert.ok(components.some((component) => component.properties?.some((property) => property.name === 'kitculture:projectPath' && property.value === '.')))
  assert.ok(components.some((component) => component.properties?.some((property) => property.name === 'kitculture:projectPath' && property.value === 'platform')))
  assert.ok((bom.dependencies as { ref: string; dependsOn: string[] }[]).every((dependency) => references.has(dependency.ref) && dependency.dependsOn.every((reference) => references.has(reference))))
})

test('OSV scanner sends only lockfile package names and versions and maps advisories', async (context) => {
  const root = mkdtempSync(join(tmpdir(), 'kitculture-osv-test-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules', 'sample-package'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'osv-fixture', version: '1.0.0' }))
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: 'osv-fixture',
    version: '1.0.0',
    lockfileVersion: 3,
    packages: {
      '': { name: 'osv-fixture', version: '1.0.0', dependencies: { 'sample-package': '^1.2.3' } },
      'node_modules/sample-package': { name: 'sample-package', version: '1.2.3' },
    },
  }))
  let submittedQueries: unknown[] = []
  const fetcher: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { queries: unknown[] }
    submittedQueries = body.queries
    return new Response(JSON.stringify({ results: [{ vulns: [{
      id: 'GHSA-test-1234',
      aliases: ['CVE-2026-12345'],
      summary: 'Test advisory',
      database_specific: { severity: 'HIGH', cwe_ids: ['CWE-79'] },
      affected: [{ ranges: [{ events: [{ fixed: '1.2.4' }] }] }],
    }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await runOsvScanner({ cwd: root, endpoint: 'https://osv.example.test/v1/querybatch', fetcher })
  assert.deepEqual(submittedQueries, [{ package: { name: 'sample-package', ecosystem: 'npm' }, version: '1.2.3' }])
  assert.equal(result.findings[0]?.severity, 'HIGH')
  assert.deepEqual(result.findings[0]?.cve, ['CVE-2026-12345'])
  assert.equal(result.findings[0]?.evidence.fixedVersions, '1.2.4')
  assert.equal(result.summary.scanner, 'osv')
})

test('dependency scanner discovers Kitz and MarketHub lockfiles from either project directory', () => {
  const rootTargets = discoverNpmAuditTargets(process.cwd()).map((target) => target.lockfile.replaceAll('\\', '/'))
  const platformTargets = discoverNpmAuditTargets(`${process.cwd()}/platform`).map((target) => target.lockfile.replaceAll('\\', '/'))
  assert.deepEqual(platformTargets, rootTargets)
  assert.ok(rootTargets.some((target) => target.endsWith('/package-lock.json')))
  assert.ok(rootTargets.some((target) => target.endsWith('/platform/package-lock.json')))
})

test('daily dependency scan schedule advances to the next UTC occurrence', () => {
  assert.equal(nextDailyRunAt('daily@02:30Z', new Date('2026-11-16T02:30:00.000Z')).toISOString(), '2026-11-17T02:30:00.000Z')
  assert.throws(() => nextDailyRunAt('0 2 * * *', new Date('2026-11-16T00:00:00.000Z')), /INVALID_DEPENDENCY_SCAN_SCHEDULE/)
})

test('dependency scan recovery waits past the maximum supported scan timeout', () => {
  assert.equal(dependencyScanRecoveryCutoff(new Date('2026-11-16T12:00:00.000Z')).toISOString(), '2026-11-16T11:40:00.000Z')
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
