import { X509Certificate } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function normalizeCaPem(value) {
  if (typeof value !== 'string') return undefined
  const pem = value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  return pem || undefined
}

export function readSupabaseCa({ caFile, caContents } = {}) {
  let pem = normalizeCaPem(caContents)
  if (!pem && caFile) {
    try {
      pem = normalizeCaPem(readFileSync(resolve(caFile), 'utf8'))
    } catch {
      throw new Error('SUPABASE_CA_CERT_FILE could not be read.')
    }
  }
  if (!pem) return undefined
  if (!pem.includes('-----BEGIN CERTIFICATE-----') || !pem.includes('-----END CERTIFICATE-----')) {
    throw new Error('Supabase CA configuration must contain a PEM certificate.')
  }

  let certificate
  try {
    certificate = new X509Certificate(pem)
  } catch {
    throw new Error('Supabase CA configuration is not a valid X.509 certificate.')
  }
  if (!certificate.ca) throw new Error('Supabase CA configuration must be a CA certificate.')
  const now = Date.now()
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) < now) {
    throw new Error('Supabase CA certificate is outside its validity period.')
  }
  return pem
}

export function createPostgresSslOptions(config, { requireCa = false } = {}) {
  const ca = readSupabaseCa(config)
  if (requireCa && !ca) throw new Error('Supabase CA certificate is required.')
  return { rejectUnauthorized: true, ...(ca ? { ca } : {}) }
}