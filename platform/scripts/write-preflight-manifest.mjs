import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputDirectory = process.argv[2]
if (!outputDirectory) throw new Error('Provide the preflight artifact directory.')
const manifest = {
  workflow: 'MarketHub migration preflight',
  target: process.env.MARKETHUB_TARGET ?? 'unknown',
  commit: process.env.GITHUB_SHA ?? 'unknown',
  runId: process.env.GITHUB_RUN_ID ?? 'unknown',
  status: process.env.MARKETHUB_PREFLIGHT_STATUS ?? 'unknown',
  backupReference: process.env.MARKETHUB_BACKUP_REFERENCE ?? null,
  generatedAt: new Date().toISOString(),
}
await writeFile(path.join(outputDirectory, 'preflight-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')