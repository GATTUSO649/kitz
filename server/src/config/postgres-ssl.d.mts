export interface SupabaseCaConfiguration {
  caFile?: string
  caContents?: string
}

export function normalizeCaPem(value?: string): string | undefined
export function readSupabaseCa(config?: SupabaseCaConfiguration): string | undefined
export function createPostgresSslOptions(config?: SupabaseCaConfiguration, options?: { requireCa?: boolean }): {
  rejectUnauthorized: true
  ca?: string
}