import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { DependencyFinding } from './dependency-scanner.js'

const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.playwright-mcp', '.next', '.vite'])
const maxFileBytes = 512 * 1024
const maxFiles = 20_000
const maxFindings = 10_000
const placeholderValue = /(?:replace[-_ ]?this|example|sample|placeholder|your[-_ ]|changeme|todo|dummy|redacted|not[-_ ]set)/i
const sensitiveName = /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|database_url|redis_url)/i
const dotenvAssignment = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(\S.{15,})\s*$/
const configAssignment = /^\s*["']?([A-Z][A-Z0-9_]*)["']?\s*[:=]\s*(["'])(.{16,}?)\2\s*(?:[#;].*)?$/
const sourceAssignment = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])(.{16,}?)\2/
const sourcePropertyAssignment = /(?:^|[,{\s])([A-Za-z_$][\w$]*)\s*:\s*(["'])(.{16,}?)\2/
const knownToken = /\b(gh[pousr]_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|sk_(?:live|test)_[A-Za-z0-9]{16,})\b/g
const privateKeyHeader = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/

function maskedFingerprint(filePath: string, lineNumber: number, ruleId: string) {
  return createHash('sha256').update(`${filePath}\0${lineNumber}\0${ruleId}`).digest('hex').slice(0, 16)
}

function finding(filePath: string, lineNumber: number, ruleId: string): DependencyFinding {
  const fingerprint = maskedFingerprint(filePath, lineNumber, ruleId)
  const deduplicationKey = `${filePath}:${ruleId}:${fingerprint}`
  return {
    id: randomUUID(),
    scanner: 'repository-secret-scanner',
    title: ruleId === 'private-key' ? 'Private key material detected' : 'Potential hardcoded credential detected',
    description: 'A potential secret was detected locally. The value is not retained or returned; rotate confirmed credentials and move them to the approved secret store.',
    severity: 'HIGH',
    cve: [],
    cwe: ['CWE-798'],
    affectedComponent: filePath,
    affectedFile: filePath,
    evidence: { ruleId, line: lineNumber, fingerprint },
    remediation: 'Verify locally, rotate if valid, remove it from tracked files and history through the approved repository process, and use managed secret configuration.',
    deduplicationKey,
    lifecycleStatus: 'OPEN',
    verificationStatus: 'UNVERIFIED',
  }
}

export function scanTextForSecrets(source: string, filePath: string): DependencyFinding[] {
  const findings = new Map<string, DependencyFinding>()
  const isDotenv = /(^|\/)[^/]*\.env(?:\.[^/]*)?$/.test(filePath)
  const isConfig = /\.(?:ya?ml|toml|ini|properties)$/i.test(filePath)
  const lines = source.split(/\r?\n/)
  lines.forEach((line, index) => {
    const assignments = isDotenv ? [dotenvAssignment.exec(line)]
      : isConfig ? [configAssignment.exec(line)]
        : [sourceAssignment.exec(line), sourcePropertyAssignment.exec(line)]
    for (const assignment of assignments) {
      const name = assignment?.[1]
      const value = assignment?.[isDotenv ? 2 : 3]
      if (!name || !value || !sensitiveName.test(name) || placeholderValue.test(value)) continue
      const item = finding(filePath, index + 1, 'sensitive-assignment')
      findings.set(item.deduplicationKey, item)
    }
    if (privateKeyHeader.test(line)) {
      const item = finding(filePath, index + 1, 'private-key')
      findings.set(item.deduplicationKey, item)
    }
    knownToken.lastIndex = 0
    if (knownToken.test(line)) {
      const item = finding(filePath, index + 1, 'known-token-format')
      findings.set(item.deduplicationKey, item)
    }
  })
  return [...findings.values()]
}

export async function runRepositorySecretScanner(options: { cwd: string; signal?: AbortSignal }) {
  const root = resolve(options.cwd)
  const pending = [root]
  const findings: DependencyFinding[] = []
  let scannedFiles = 0
  let skippedFiles = 0
  let visitedEntries = 0

  while (pending.length && visitedEntries < maxFiles) {
    if (options.signal?.aborted) throw new Error('SECRET_SCAN_CANCELLED')
    const directory = pending.pop()!
    let entries
    try { entries = readdirSync(directory, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (++visitedEntries > maxFiles) break
      if (options.signal?.aborted) throw new Error('SECRET_SCAN_CANCELLED')
      const fullPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name) && !entry.isSymbolicLink()) pending.push(fullPath)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = statSync(fullPath)
        if (stat.size > maxFileBytes) { skippedFiles++; continue }
        const bytes = readFileSync(fullPath)
        if (bytes.includes(0)) { skippedFiles++; continue }
        const filePath = relative(root, fullPath).replaceAll('\\', '/')
        if (findings.length < maxFindings) findings.push(...scanTextForSecrets(bytes.toString('utf8'), filePath).slice(0, maxFindings - findings.length))
        scannedFiles++
      } catch {
        skippedFiles++
      }
    }
  }

  return {
    findings,
    summary: {
      scanner: 'repository-secret-scanner',
      scannedFiles,
      skippedFiles,
      findings: findings.length,
      valuesMasked: true,
      thirdPartyServicesUsed: false,
    },
  }
}