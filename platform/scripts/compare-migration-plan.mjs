import { readFile } from 'node:fs/promises'

const approvedDirectory = process.env.MARKETHUB_PREFLIGHT_ARTIFACT_DIRECTORY
const currentPlanPath = process.env.MARKETHUB_CURRENT_PLAN
const currentDatabasePath = process.env.MARKETHUB_CURRENT_DATABASE_REPORT
const currentManifestPath = process.env.MARKETHUB_CURRENT_MANIFEST_REPORT
if (!approvedDirectory || !currentPlanPath || !currentDatabasePath || !currentManifestPath) throw new Error('Migration plan comparison is missing report paths.')

const [approvedPlan, currentPlan, approvedManifest, currentManifest, approvedDatabase, currentDatabase] = await Promise.all([
  readFile(`${approvedDirectory}/migration-plan.json`, 'utf8').then(JSON.parse),
  readFile(currentPlanPath, 'utf8').then(JSON.parse),
  readFile(`${approvedDirectory}/manifest-validation.json`, 'utf8').then(JSON.parse),
  readFile(currentManifestPath, 'utf8').then(JSON.parse),
  readFile(`${approvedDirectory}/database-preflight.json`, 'utf8').then(JSON.parse),
  readFile(currentDatabasePath, 'utf8').then(JSON.parse),
])

if (approvedPlan.problems?.length || currentPlan.problems?.length) throw new Error('A migration plan contains unresolved blockers.')
if (JSON.stringify(approvedPlan.pendingVersions) !== JSON.stringify(currentPlan.pendingVersions)) throw new Error('Pending migration versions changed after preflight; generate and review a new plan.')
if (JSON.stringify(approvedPlan.remoteOnlyVersions) !== JSON.stringify(currentPlan.remoteOnlyVersions)) throw new Error('Remote-only migration versions changed after preflight; reconcile the ledger before release.')
if (!approvedManifest.valid || !currentManifest.valid) throw new Error('A MarketHub migration manifest validation did not pass.')
if (JSON.stringify(approvedManifest.approvedPendingMigrationIds) !== JSON.stringify(currentManifest.approvedPendingMigrationIds)) {
  throw new Error('Approved Marketplace migration IDs changed after preflight; generate and review a new plan.')
}
if (approvedDatabase.issues?.length || currentDatabase.issues?.length) throw new Error('Database identity or permission checks failed.')
if (!approvedDatabase.publicSchemaFingerprint || approvedDatabase.publicSchemaFingerprint !== currentDatabase.publicSchemaFingerprint) {
  throw new Error('Kitz public-schema fingerprint changed after preflight; abort MarketHub migration.')
}
process.stdout.write('Approved migration plan, ledger, target and public-schema fingerprint are unchanged.\n')