import { readFile } from 'node:fs/promises'
import path from 'node:path'

const repository = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN
const runId = process.env.MARKETHUB_PREFLIGHT_RUN_ID
const expectedCommit = process.env.GITHUB_SHA
const expectedTarget = process.env.MARKETHUB_TARGET
const artifactDirectory = process.env.MARKETHUB_PREFLIGHT_ARTIFACT_DIRECTORY

function requireEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`Approved preflight ${label} does not match this release.`)
}

async function main() {
  if (!repository || !token || !runId || !expectedCommit || !expectedTarget || !artifactDirectory) {
    throw new Error('Preflight run verification is missing a required release input.')
  }
  if (!/^\d+$/.test(runId)) throw new Error('Preflight run ID must be numeric.')

  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`Could not verify the preflight run through GitHub (HTTP ${response.status}).`)
  const run = await response.json()
  requireEqual(run.path, '.github/workflows/markethub-preflight.yml', 'workflow')
  requireEqual(run.head_branch, 'main', 'branch')
  requireEqual(run.head_sha, expectedCommit, 'commit SHA')
  requireEqual(run.conclusion, 'success', 'status')

  const manifest = JSON.parse(await readFile(path.join(artifactDirectory, 'preflight-manifest.json'), 'utf8'))
  const migrationPlan = JSON.parse(await readFile(path.join(artifactDirectory, 'migration-plan.json'), 'utf8'))
  const migrationManifest = JSON.parse(await readFile(path.join(artifactDirectory, 'manifest-validation.json'), 'utf8'))
  const database = JSON.parse(await readFile(path.join(artifactDirectory, 'database-preflight.json'), 'utf8'))
  requireEqual(manifest.runId, runId, 'artifact run ID')
  requireEqual(manifest.commit, expectedCommit, 'artifact commit SHA')
  requireEqual(manifest.target, expectedTarget, 'target environment')
  requireEqual(manifest.status, 'success', 'artifact status')
  if (migrationPlan.problems?.length) throw new Error('The approved preflight contains unresolved migration blockers.')
  if (!migrationManifest.valid || migrationManifest.errors?.length) throw new Error('The approved preflight manifest validation did not pass.')
  if (database.issues?.length) throw new Error('The approved preflight contains unresolved database verification blockers.')
  if (!database.publicSchemaFingerprint) throw new Error('The preflight is missing the Kitz public-schema fingerprint.')
  process.stdout.write(`Approved preflight verified: run ${runId}, ${expectedTarget}, ${expectedCommit}\n`)
}

main().catch((error) => {
  process.stderr.write(`Release gate blocked: ${error instanceof Error ? error.message : 'unknown failure'}\n`)
  process.exitCode = 1
})