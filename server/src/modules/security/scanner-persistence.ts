import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as adminSchema from '../../database/admin-schema.js'
import { desc, eq } from 'drizzle-orm'
import type { DependencyFinding } from './dependency-scanner.js'
import type { SecurityScan } from './scanner-engine.js'
import { securityFindings, securityScanModules, securityScans } from '../../database/admin-schema.js'

export async function persistSecurityScan(database: NodePgDatabase<typeof adminSchema>, scan: SecurityScan, requestedByOperationsUserId?: number) {
  const [storedScan] = await database.insert(securityScans).values({
    scanId: scan.id,
    requestedByOperationsUserId,
    status: scan.status,
    scope: scan.scope[0] ?? 'repository',
    moduleCount: scan.modules.length,
    findingCount: scan.findings.length,
    summary: scan.summary,
    errorCode: scan.errorCode,
    startedAt: new Date(scan.startedAt),
    completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
  }).onConflictDoUpdate({
    target: securityScans.scanId,
    set: {
      status: scan.status,
      moduleCount: scan.modules.length,
      findingCount: scan.findings.length,
      summary: scan.summary,
      errorCode: scan.errorCode,
      completedAt: scan.completedAt ? new Date(scan.completedAt) : null,
    },
  }).returning({ id: securityScans.id })

  if (!storedScan) return
  for (const module of scan.modules) {
    const [storedModule] = await database.insert(securityScanModules).values({
      scanId: storedScan.id,
      module: module.module,
      status: module.status,
      findingCount: module.findingCount,
      unsupportedReason: module.unsupportedReason,
      errorCode: module.errorCode,
      startedAt: module.startedAt ? new Date(module.startedAt) : null,
      completedAt: module.completedAt ? new Date(module.completedAt) : null,
    }).onConflictDoUpdate({
      target: [securityScanModules.scanId, securityScanModules.module],
      set: {
        status: module.status,
        findingCount: module.findingCount,
        unsupportedReason: module.unsupportedReason,
        errorCode: module.errorCode,
        startedAt: module.startedAt ? new Date(module.startedAt) : null,
        completedAt: module.completedAt ? new Date(module.completedAt) : null,
      },
    }).returning({ id: securityScanModules.id })

    if (!storedModule) continue
    const moduleFindings = module.module === 'dependency' ? scan.findings : []
    for (const finding of moduleFindings) {
      await database.insert(securityFindings).values({
        findingId: finding.id,
        scanModuleId: storedModule.id,
        deduplicationKey: finding.deduplicationKey,
        source: finding.scanner,
        title: finding.title,
        description: finding.description,
        severity: finding.severity,
        cve: finding.cve[0] ?? null,
        cwe: finding.cwe[0] ?? null,
        cvssScore: finding.evidence.cvssScore === null || finding.evidence.cvssScore === undefined ? null : String(finding.evidence.cvssScore),
        affectedComponent: finding.affectedComponent,
        affectedFile: finding.affectedFile,
        affectedEndpoint: null,
        evidence: finding.evidence,
        remediation: finding.remediation,
        lifecycleStatus: finding.lifecycleStatus ?? 'OPEN',
        verificationStatus: finding.verificationStatus ?? 'UNVERIFIED',
      }).onConflictDoUpdate({
        target: [securityFindings.source, securityFindings.deduplicationKey],
        set: {
          scanModuleId: storedModule.id,
          title: finding.title,
          description: finding.description,
          severity: finding.severity,
          evidence: finding.evidence,
          remediation: finding.remediation,
          lastObservedAt: new Date(),
        },
      })
    }
  }
}

export async function loadPersistedSecurityScans(database: NodePgDatabase<typeof adminSchema>): Promise<SecurityScan[]> {
  const storedScans = await database.select().from(securityScans).orderBy(desc(securityScans.createdAt)).limit(100)
  const loaded: SecurityScan[] = []
  for (const scan of storedScans) {
    const modules = await database.select().from(securityScanModules).where(eq(securityScanModules.scanId, scan.id))
    const findingRows = await database.select({ finding: securityFindings }).from(securityFindings)
      .innerJoin(securityScanModules, eq(securityScanModules.id, securityFindings.scanModuleId))
      .where(eq(securityScanModules.scanId, scan.id))
    const findings: DependencyFinding[] = findingRows.map(({ finding }) => ({
      id: finding.findingId,
      scanner: finding.source,
      title: finding.title,
      description: finding.description,
      severity: finding.severity as DependencyFinding['severity'],
      cve: finding.cve ? [finding.cve] : [],
      cwe: finding.cwe ? [finding.cwe] : [],
      affectedComponent: finding.affectedComponent ?? 'unknown',
      affectedFile: finding.affectedFile ?? '',
      evidence: finding.evidence as Record<string, string | number | boolean | null>,
      remediation: finding.remediation ?? 'Review and apply an approved remediation.',
      deduplicationKey: finding.deduplicationKey,
      lifecycleStatus: finding.lifecycleStatus,
      verificationStatus: finding.verificationStatus,
    }))
    loaded.push({
      id: scan.scanId,
      status: scan.status as SecurityScan['status'],
      scope: [scan.scope] as SecurityScan['scope'],
      modules: modules.map((module) => ({
        module: module.module as SecurityScan['modules'][number]['module'],
        status: module.status as SecurityScan['modules'][number]['status'],
        findingCount: module.findingCount,
        unsupportedReason: module.unsupportedReason ?? undefined,
        errorCode: module.errorCode ?? undefined,
        startedAt: module.startedAt?.toISOString(),
        completedAt: module.completedAt?.toISOString(),
      })),
      findings,
      summary: scan.summary as Record<string, string | number | boolean | null>,
      errorCode: scan.errorCode ?? undefined,
      startedAt: scan.createdAt.toISOString(),
      completedAt: scan.completedAt?.toISOString(),
    })
  }
  return loaded
}
