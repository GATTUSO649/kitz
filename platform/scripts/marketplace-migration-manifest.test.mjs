import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { sha256, validateExecutionGate, validateManifest } from './marketplace-migration-manifest.mjs'

const migrationId = '20261109000000'
const migrationFile = `supabase/migrations/${migrationId}_marketplace_test.sql`
const safeSql = 'ALTER TABLE "marketplace"."marketplace_example" ADD COLUMN "verified_at" timestamptz;\n'

async function createFixture(t, sql = safeSql) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'markethub-manifest-'))
  const absoluteMigrationPath = path.join(root, migrationFile)
  await mkdir(path.dirname(absoluteMigrationPath), { recursive: true })
  await writeFile(absoluteMigrationPath, sql)
  t.after(() => rm(root, { recursive: true, force: true }))
  const entry = {
    id: migrationId,
    file: migrationFile,
    sha256: sha256(sql),
    targetSchema: 'marketplace',
    reviewStatus: 'reviewed',
    approvalStatus: 'approved',
    executionStatus: 'pending',
    dependencies: [],
  }
  return { root, entry }
}

test('accepts a reviewed and approved Marketplace-only pending migration with matching checksum', async (t) => {
  const { root, entry } = await createFixture(t)
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId] })
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.approvedPending.map(({ id }) => id), [migrationId])
  assert.deepEqual(result.plannedChanges, { createdTables: [], addedColumns: ['marketplace_example.verified_at'] })
})

test('rejects public-schema SQL even when manifest metadata claims Marketplace', async (t) => {
  const { root, entry } = await createFixture(t, 'ALTER TABLE public.payments ADD COLUMN note text;\n')
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId] })
  assert.ok(result.errors.some((error) => /public-schema reference/.test(error)))
  assert.ok(result.errors.some((error) => /not provably confined/.test(error)))
})

test('rejects pending migrations absent from the approved manifest and unknown dependencies', async (t) => {
  const { root, entry } = await createFixture(t)
  entry.dependencies = ['20261108000000']
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId, '20261110000000'] })
  assert.ok(result.errors.some((error) => /unknown dependency/.test(error)))
  assert.ok(result.errors.some((error) => /not explicitly approved/.test(error)))
})

test('rejects a migration whose SQL checksum changed', async (t) => {
  const { root, entry } = await createFixture(t)
  entry.sha256 = '0'.repeat(64)
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId] })
  assert.ok(result.errors.some((error) => /checksum does not match/.test(error)))
})

test('rejects duplicate migration identifiers', async (t) => {
  const { root, entry } = await createFixture(t)
  const result = await validateManifest({ version: 1, migrations: [entry, { ...entry }] }, { root, pendingIds: [migrationId] })
  assert.ok(result.errors.some((error) => /Duplicate migration identifier/.test(error)))
})

test('requires a database credential and protected-environment approval reference', () => {
  assert.deepEqual(validateExecutionGate({}), [
    'MARKETPLACE_MIGRATION_DATABASE_URL is required.',
    'Production environment approval reference is required.',
    'Verified backup and recovery reference is required.',
  ])
  assert.deepEqual(validateExecutionGate({ databaseUrl: 'postgresql://configured', backupVerified: 'true', backupReference: 'backup-123' }), [
    'Production environment approval reference is required.',
  ])
  assert.ok(validateExecutionGate({ databaseUrl: ' ', approvalReference: ' ', backupVerified: 'true', backupReference: ' ' }).length > 0)
})

test('rejects an entry that is not explicitly approved', async (t) => {
  const { root, entry } = await createFixture(t)
  entry.approvalStatus = 'pending'
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId] })
  assert.ok(result.errors.some((error) => /not been explicitly approved/.test(error)))
})

test('blocks a destructive Marketplace migration without a separate approval reference', async (t) => {
  const destructiveSql = 'DROP TABLE "marketplace"."marketplace_example";\n'
  const { root, entry } = await createFixture(t, destructiveSql)
  const result = await validateManifest({ version: 1, migrations: [entry] }, { root, pendingIds: [migrationId] })
  assert.ok(result.errors.some((error) => /without explicit approval reference/.test(error)))
})

test('missing read-only preflight credentials produce a sanitized structured failure without connecting', async (t) => {
  const reportPath = path.join(await mkdtemp(path.join(os.tmpdir(), 'markethub-preflight-')), 'blocked.json')
  t.after(() => rm(path.dirname(reportPath), { recursive: true, force: true }))
  const testDirectory = path.dirname(fileURLToPath(import.meta.url))
  const scriptPath = path.join(testDirectory, 'database-preflight.mjs')
  const env = { ...process.env,
    MARKETHUB_PREFLIGHT_ONLY: 'true',
    MARKETPLACE_DATABASE_NAME: 'postgres',
    MARKETPLACE_DATABASE_HOST: 'configured-host.example',
    MARKETPLACE_DATABASE_USER: 'runtime_role',
    MARKETPLACE_DATABASE_SCHEMA: 'marketplace',
    MARKETPLACE_DATABASE_CA: 'credential-marker-must-not-leak',
  }
  delete env.MARKETHUB_PREFLIGHT_DATABASE_URL
  delete env.MARKETPLACE_DATABASE_URL
  delete env.MARKETPLACE_MIGRATION_DATABASE_URL
  const result = spawnSync(process.execPath, [scriptPath, '--report', reportPath], { cwd: path.resolve(testDirectory, '..'), env, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  const report = JSON.parse(await (await import('node:fs/promises')).readFile(reportPath, 'utf8'))
  assert.equal(report.status, 'blocked')
  assert.equal(report.readOnly, true)
  assert.ok(report.issues.some((issue) => /MARKETHUB_PREFLIGHT_DATABASE_URL is required/.test(issue)))
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}\n${JSON.stringify(report)}`, /credential-marker-must-not-leak/)
})