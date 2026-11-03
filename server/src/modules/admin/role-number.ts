import { sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { AdministratorRole } from '../../database/admin-schema.js'
import * as adminSchema from '../../database/admin-schema.js'
import { rolePrefix } from './administration.js'

export async function allocateAdministratorRoleNumber(database: NodePgDatabase<typeof adminSchema>, role: AdministratorRole) {
  const prefix = rolePrefix(role)
  await database.execute(sql.raw(`SELECT pg_advisory_xact_lock(hashtext('${prefix}'))`))
  const result = await database.execute(sql`
    SELECT COALESCE(MAX(NULLIF(regexp_replace(role_number, '^${sql.raw(prefix)}-', ''), '')::integer), 0)::integer AS maximum
    FROM admin_users
    WHERE role_number LIKE ${`${prefix}-%`}
  `) as unknown as { rows: { maximum: number }[] }
  return `${prefix}-${String(Number(result.rows[0]?.maximum ?? 0) + 1).padStart(4, '0')}`
}
