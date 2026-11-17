export interface SupabaseCaConfiguration {
  caFile?: string
  caContents?: string
}

export interface PostgresSslOptions {
  requireCa?: boolean
  connectionName?: string
  caFileVariable?: string
  caContentsVariable?: string
}

export function normalizeCaPem(value?: string): string | undefined
export function readSupabaseCa(config?: SupabaseCaConfiguration, options?: Omit<PostgresSslOptions, 'requireCa'>): string | undefined
export function createPostgresSslOptions(config?: SupabaseCaConfiguration, options?: PostgresSslOptions): {
  rejectUnauthorized: true
  ca?: string
}

export function createAdminMigrationSslOptions(configuration?: {
  migrationUrl?: string
  runtimeAdminUrl?: string
  migrationCaFile?: string
  migrationCaContents?: string
  adminCaFile?: string
  adminCaContents?: string
  requireCa?: boolean
}): {
  rejectUnauthorized: true
  ca?: string
}