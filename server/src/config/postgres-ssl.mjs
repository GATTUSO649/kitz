import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function normalizeCaPem(value) {
  if (typeof value !== 'string') return undefined
  const pem = value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  return pem || undefined
}

export function readSupabaseCa(
  { caFile, caContents } = {},
  { connectionName = 'PostgreSQL', caFileVariable = 'SUPABASE_CA_CERT_FILE', caContentsVariable = 'SUPABASE_CA_CERT' } = {},
) {
  let pem = normalizeCaPem(caContents)
  if (!pem && caFile) {
    try {
      pem = normalizeCaPem(readFileSync(resolve(caFile), 'utf8'))
    } catch {
      throw new Error(`${connectionName}: ${caFileVariable} could not be read.`)
    }
  }
  if (!pem) return undefined
  if (!pem.includes('-----BEGIN CERTIFICATE-----') || !pem.includes('-----END CERTIFICATE-----')) {
    throw new Error(`${connectionName}: ${caContentsVariable} or ${caFileVariable} must contain a PEM CA certificate.`)
  }

  let certificate
  try {
    certificate = new X509Certificate(pem)
  } catch {
    throw new Error(`${connectionName}: configured CA is not a valid X.509 certificate.`)
  }
  if (!certificate.ca) throw new Error(`${connectionName}: configured certificate is not a CA certificate.`)
  const now = Date.now()
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
    throw new Error(`${connectionName}: configured CA certificate is outside its validity period.`)
  }
  return pem
}

export function createPostgresSslOptions(config, {
  requireCa = false,
  connectionName = 'PostgreSQL',
  caFileVariable = 'SUPABASE_CA_CERT_FILE',
  caContentsVariable = 'SUPABASE_CA_CERT',
} = {}) {
  const ca = readSupabaseCa(config, { connectionName, caFileVariable, caContentsVariable })
  if (requireCa && !ca) {
    throw new Error(`${connectionName}: set ${caContentsVariable} or ${caFileVariable} to the Supabase CA certificate.`)
  }
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}

function supabaseProjectReference(value) {
  if (!value) return null
  try {
    const url = new URL(value)
    const direct = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)?.[1]
    const pooled = /^(?:postgres|supabase_admin)\.([a-z0-9-]+)$/i.exec(decodeURIComponent(url.username))?.[1]
    return (direct ?? pooled)?.toLowerCase() ?? null
  } catch {
    return null
  }
}

export function createAdminMigrationSslOptions({
  migrationUrl,
  runtimeAdminUrl,
  migrationCaFile,
  migrationCaContents,
  adminCaFile,
  adminCaContents,
  requireCa = false,
} = {}) {
  const migrationProject = supabaseProjectReference(migrationUrl)
  const runtimeAdminProject = supabaseProjectReference(runtimeAdminUrl)
  const sharesAdminProject = Boolean(migrationProject && runtimeAdminProject && migrationProject === runtimeAdminProject)
  if (runtimeAdminUrl && !sharesAdminProject) {
    throw new Error('Admin ADMIN_MIGRATION_DATABASE_URL must identify the same Supabase project as ADMIN_DATABASE_URL.')
  }

  return createPostgresSslOptions({
    caFile: migrationCaFile ?? (sharesAdminProject ? adminCaFile : undefined),
    caContents: migrationCaContents ?? (sharesAdminProject ? adminCaContents : undefined),
  }, {
    requireCa,
    connectionName: 'Admin ADMIN_MIGRATION_DATABASE_URL',
    caFileVariable: 'ADMIN_MIGRATION_SUPABASE_CA_CERT_FILE or ADMIN_SUPABASE_CA_CERT_FILE',
    caContentsVariable: 'ADMIN_MIGRATION_SUPABASE_CA_CERT or ADMIN_SUPABASE_CA_CERT',
  })
}