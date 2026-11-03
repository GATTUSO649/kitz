console.error('Drizzle migration execution is disabled. Supabase CLI owns migration deployment; run npm run db:supabase:dry-run and deploy only from the approved release workflow.')
process.exitCode = 1
