import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const reportPath = process.argv[2]
if (!reportPath) throw new Error('Provide the deployment report path.')
const fields = [
  ['Commit SHA', process.env.GITHUB_SHA ?? 'unknown'],
  ['Workflow run', process.env.GITHUB_RUN_ID ?? 'unknown'],
  ['Target environment', process.env.MARKETHUB_TARGET ?? 'unknown'],
  ['Preflight run', process.env.MARKETHUB_PREFLIGHT_RUN_ID ?? 'unknown'],
  ['Backup/restore reference', process.env.MARKETHUB_BACKUP_REFERENCE ?? 'not supplied'],
  ['Validation', process.env.MARKETHUB_VALIDATION_RESULT ?? 'not run'],
  ['TypeScript checks', process.env.MARKETHUB_TYPECHECK_RESULT ?? 'not run'],
  ['Test results', process.env.MARKETHUB_TEST_RESULT ?? 'not run'],
  ['Lint and diff hygiene', process.env.MARKETHUB_LINT_RESULT ?? 'not run'],
  ['Production build', process.env.MARKETHUB_BUILD_RESULT ?? 'not run'],
  ['Dependency security audit', process.env.MARKETHUB_SECURITY_RESULT ?? 'not run'],
  ['Migration audit', process.env.MARKETHUB_MIGRATION_AUDIT_RESULT ?? 'not run'],
  ['Database apply', process.env.MARKETHUB_MIGRATION_APPLY_RESULT ?? 'not run'],
    ['Supabase migration ledger modified by automation', 'no'],
  ['Post-migration verification', process.env.MARKETHUB_POSTFLIGHT_RESULT ?? 'not run'],
  ['Render deployment', process.env.MARKETHUB_RENDER_RESULT ?? 'not run'],
  ['Render deployment ID', process.env.MARKETHUB_RENDER_DEPLOY_ID ?? 'not created'],
  ['Production health', process.env.MARKETHUB_HEALTH_RESULT ?? 'not run'],
]
const approvedPlanPath = process.env.MARKETHUB_APPROVED_MIGRATION_PLAN
const finalAuditPath = process.env.MARKETHUB_FINAL_MIGRATION_AUDIT
const executionReportPath = process.env.MARKETHUB_MIGRATION_EXECUTION_REPORT
let pendingVersions = null
let appliedVersions = null
if (approvedPlanPath) {
  try {
    const plan = JSON.parse(await readFile(approvedPlanPath, 'utf8'))
    pendingVersions = plan.pendingVersions ?? []
    if (finalAuditPath) {
      const finalAudit = JSON.parse(await readFile(finalAuditPath, 'utf8'))
      const finalPending = new Set(finalAudit.pendingVersions ?? [])
      appliedVersions = pendingVersions.filter((version) => !finalPending.has(version))
      pendingVersions = [...finalPending]
    }
  } catch {
    pendingVersions = null
  }
}
const detailFiles = (process.env.MARKETHUB_FAILURE_DETAIL_FILES ?? '').split(/\r?\n/).filter(Boolean)
const secretValues = Object.entries(process.env)
  .filter(([name, value]) => value && /URL|TOKEN|PASSWORD|SECRET|API_KEY|\bCA\b/i.test(name))
  .map(([, value]) => value)
const errorDetails = []
for (const filename of detailFiles) {
  try {
    let content = await readFile(filename, 'utf8')
    for (const secret of secretValues) content = content.split(secret).join('[REDACTED]')
    content = content.replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    if (filename.endsWith('.json')) {
      const result = JSON.parse(content)
      const details = [...(result.issues ?? []), ...(result.problems ?? [])]
      if (result.error) details.push(`${result.stage ?? 'unknown stage'}: ${result.error}`)
      if (details.length) errorDetails.push(`- ${path.basename(filename)}: ${details.join('; ')}`)
    } else {
      const lines = content.trim().split(/\r?\n/).filter(Boolean).slice(-12)
      if (lines.length) errorDetails.push(`- ${path.basename(filename)}:\n\n  ${lines.join('\n  ')}`)
    }
  } catch {
    // Missing logs are expected when a stage did not run.
  }
}
if (executionReportPath) {
  try {
    const execution = JSON.parse(await readFile(executionReportPath, 'utf8'))
    appliedVersions = execution.status === 'passed' ? execution.migrationIds ?? [] : []
  } catch {
    appliedVersions = null
  }
}
const report = [
  '# MarketHub Deployment Report',
  '',
  ...fields.map(([name, value]) => `- ${name}: ${value}`),
  `- Pending migrations after release: ${pendingVersions?.join(', ') || (pendingVersions ? 'none' : 'not available')}`,
  `- Migrations applied in this release: ${appliedVersions?.join(', ') || (appliedVersions ? 'none' : 'not available')}`,
  '',
  '## Failure details',
  '',
  ...(errorDetails.length ? errorDetails : ['- No captured failure details. See workflow step logs for stage-level output.']),
  '',
  `Generated: ${new Date().toISOString()}`,
  '',
  'Secrets, connection URLs, access tokens, and database row contents are intentionally excluded.',
].join('\n') + '\n'

await writeFile(path.resolve(reportPath), report, 'utf8')
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report, { flag: 'a' })