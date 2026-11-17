export function databaseTargetIdentity(value: string): string | null {
  try {
    const url = new URL(value)
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) return null

    const directSupabaseProject = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname)?.[1]
    const pooledSupabaseProject = /^(?:postgres|supabase_admin)\.([a-z0-9-]+)$/i.exec(decodeURIComponent(url.username))?.[1]
    const supabaseProject = directSupabaseProject ?? pooledSupabaseProject
    if (supabaseProject) return `supabase:${supabaseProject.toLowerCase()}`

    return `${url.hostname.toLowerCase()}:${url.port || '5432'}${url.pathname}`
  } catch {
    return null
  }
}

export function areSameDatabaseTarget(first: string, second: string): boolean {
  const firstIdentity = databaseTargetIdentity(first)
  const secondIdentity = databaseTargetIdentity(second)
  return firstIdentity !== null && firstIdentity === secondIdentity
}