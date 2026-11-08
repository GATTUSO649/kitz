import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import pg from 'pg'

const { Client } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const platformDir = path.resolve(scriptDir, '..')
const repositoryDir = path.resolve(platformDir, '..')

function parseApplicationContracts(schemaSource, appSource, snapshot) {
  const tables = [...schemaSource.matchAll(/marketplaceSchema\.table\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
  const requiredBlock = appSource.match(/WITH required_tables\(name\) AS \(VALUES([\s\S]*?)\), required_privileges\(name, privilege\) AS \(VALUES([\s\S]*?)\)\s*SELECT EXISTS/)
  if (!requiredBlock) throw new Error('Could not read the MarketHub readiness table and privilege contracts.')
  const healthTables = [...requiredBlock[1].matchAll(/\('([^']+)'\)/g)].map((match) => match[1])
  const privilegePairs = [...requiredBlock[2].matchAll(/\('([^']+)'\s*,\s*'([A-Z]+)'\)/g)].map((match) => ({ table: match[1], privilege: match[2] }))
  const snapshotTables = Object.values(snapshot.tables ?? {})
  const columns = snapshotTables.flatMap((table) => Object.keys(table.columns ?? {}).map((column) => ({ table: table.name, column })))
  const indexes = snapshotTables.flatMap((table) => Object.keys(table.indexes ?? {}))
  const foreignKeys = snapshotTables.flatMap((table) => Object.keys(table.foreignKeys ?? {}))
  const checkConstraints = snapshotTables.flatMap((table) => Object.keys(table.checkConstraints ?? {}))
  const uniqueConstraints = snapshotTables.flatMap((table) => Object.keys(table.uniqueConstraints ?? {}))
  const rlsContracts = snapshotTables.map((table) => ({
    table: table.name,
    enabled: table.isRLSEnabled === true,
    policies: Object.keys(table.policies ?? {}).sort(),
  }))
  return {
    tables: [...new Set(tables)].sort(),
    healthTables: [...new Set(healthTables)].sort(),
    privilegePairs,
    columns,
    indexes: [...new Set(indexes)].sort(),
    foreignKeys: [...new Set(foreignKeys)].sort(),
    checkConstraints: [...new Set(checkConstraints)].sort(),
    uniqueConstraints: [...new Set(uniqueConstraints)].sort(),
    rlsContracts,
  }
}

function getOptions() {
  const args = process.argv.slice(2)
  const valueAfter = (name) => {
    const index = args.indexOf(name)
    return index >= 0 ? args[index + 1] : undefined
  }
  return {
    reportPath: valueAfter('--report'),
    baselinePath: valueAfter('--baseline'),
    comparePath: valueAfter('--compare'),
  }
}

function parseDatabaseUrl(value, label) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL connection URL.`)
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${label} must use PostgreSQL.`)
  return { url, user: decodeURIComponent(url.username), database: decodeURIComponent(url.pathname.replace(/^\//, '')) }
}

function createClient(url, ca) {
  const ssl = ca ? { ca, rejectUnauthorized: true } : process.env.NODE_ENV === 'production' ? undefined : false
  if (process.env.NODE_ENV === 'production' && !ca) throw new Error('MARKETPLACE_DATABASE_CA is required for production database preflight.')
  return new Client({ connectionString: url.toString(), ssl, connectionTimeoutMillis: 10_000, query_timeout: 20_000 })
}

const publicFingerprintQuery = `
WITH public_definitions AS (
  SELECT 'relation:' || relation.relname || ':' || relation.relkind || ':' || relation.relrowsecurity || ':' || relation.relforcerowsecurity AS definition
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT 'column:' || relation.relname || ':' || attribute.attnum || ':' || attribute.attname || ':' || format_type(attribute.atttypid, attribute.atttypmod) || ':' || attribute.attnotnull || ':' || COALESCE(pg_get_expr(default_value.adbin, default_value.adrelid), '')
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  LEFT JOIN pg_attrdef AS default_value ON default_value.adrelid = relation.oid AND default_value.adnum = attribute.attnum
  WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'v', 'm', 'f') AND attribute.attnum > 0 AND NOT attribute.attisdropped
  UNION ALL
  SELECT 'constraint:' || relation.relname || ':' || constraint_row.conname || ':' || pg_get_constraintdef(constraint_row.oid, true)
  FROM pg_constraint AS constraint_row
  JOIN pg_class AS relation ON relation.oid = constraint_row.conrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'index:' || relation.relname || ':' || index_row.indexrelid::regclass::text || ':' || pg_get_indexdef(index_row.indexrelid)
  FROM pg_index AS index_row
  JOIN pg_class AS relation ON relation.oid = index_row.indrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'policy:' || relation.relname || ':' || policy.polname || ':' || policy.polcmd || ':' || policy.polpermissive || ':' || array_to_string(policy.polroles, ',') || ':' || COALESCE(pg_get_expr(policy.polqual, policy.polrelid), '') || ':' || COALESCE(pg_get_expr(policy.polwithcheck, policy.polrelid), '')
  FROM pg_policy AS policy
  JOIN pg_class AS relation ON relation.oid = policy.polrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'schema_acl:' || COALESCE(namespace.nspacl::text, 'default')
  FROM pg_namespace AS namespace WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'relation_acl:' || relation.relname || ':' || COALESCE(relation.relacl::text, 'default')
  FROM pg_class AS relation
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
  UNION ALL
  SELECT 'column_acl:' || relation.relname || ':' || attribute.attname || ':' || COALESCE(attribute.attacl::text, 'default')
  FROM pg_attribute AS attribute
  JOIN pg_class AS relation ON relation.oid = attribute.attrelid
  JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public' AND attribute.attnum > 0 AND NOT attribute.attisdropped AND attribute.attacl IS NOT NULL
  UNION ALL
  SELECT 'default_acl:' || COALESCE(default_acl.defaclobjtype::text, '') || ':' || COALESCE(default_acl.defaclacl::text, 'default')
  FROM pg_default_acl AS default_acl
  JOIN pg_namespace AS namespace ON namespace.oid = default_acl.defaclnamespace
  WHERE namespace.nspname = 'public'
)
SELECT md5(COALESCE(string_agg(definition, E'\\n' ORDER BY definition), '')) AS fingerprint,
       count(*)::integer AS definition_count
FROM public_definitions
`

async function inspectConnection(label, parsed, expected, ca, contracts, issues, plannedChanges = {}) {
  const client = createClient(parsed.url, ca)
  await client.connect()
  try {
    const identityResult = await client.query(`
      SELECT current_database() AS database_name,
             current_user AS role_name,
             inet_server_addr()::text AS server_address,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace') AS marketplace_schema_exists,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace' AND has_schema_privilege(current_user, oid, 'USAGE')) AS marketplace_usage,
             EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace' AND has_schema_privilege(current_user, oid, 'CREATE')) AS marketplace_create,
             has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
             has_schema_privilege(current_user, 'public', 'CREATE') AS public_create,
             (SELECT count(*)::integer FROM pg_class AS public_relation
                JOIN pg_namespace AS public_namespace ON public_namespace.oid = public_relation.relnamespace
               WHERE public_namespace.nspname = 'public' AND public_relation.relkind IN ('r', 'v', 'm', 'f')
                 AND (has_table_privilege(current_user, public_relation.oid, 'SELECT')
                   OR has_table_privilege(current_user, public_relation.oid, 'INSERT')
                   OR has_table_privilege(current_user, public_relation.oid, 'UPDATE')
                   OR has_table_privilege(current_user, public_relation.oid, 'DELETE'))) AS public_table_privilege_count,
             (SELECT count(*)::integer FROM pg_class AS public_relation
                JOIN pg_namespace AS public_namespace ON public_namespace.oid = public_relation.relnamespace
               WHERE public_namespace.nspname = 'public' AND public_relation.relowner = role.oid) AS public_owned_relation_count,
             role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolbypassrls
      FROM pg_roles AS role WHERE role.rolname = current_user
    `)
    const identity = identityResult.rows[0]
    if (!identity || identity.database_name !== expected.databaseName || identity.role_name !== parsed.user) {
      issues.push(`${label} connected with an unexpected database identity.`)
    }
    if (expected.host && parsed.url.hostname.toLowerCase() !== expected.host.toLowerCase()) issues.push(`${label} URL host does not match MARKETPLACE_DATABASE_HOST.`)
    if (expected.databaseName && parsed.database !== expected.databaseName) issues.push(`${label} URL database does not match MARKETPLACE_DATABASE_NAME.`)
    if (!identity?.marketplace_schema_exists) issues.push(`${label} cannot find the marketplace schema.`)
    if (identity?.rolsuper || identity?.rolcreatedb || identity?.rolcreaterole || identity?.rolreplication) issues.push(`${label} database role has elevated cluster privileges.`)
    if (identity?.public_create) issues.push(`${label} database role can create objects in the protected public schema.`)
    if (identity?.public_owned_relation_count > 0) issues.push(`${label} database role owns ${identity.public_owned_relation_count} protected public-schema relations.`)

    if (label === 'preflight') {
      if (identity?.marketplace_create || identity?.public_table_privilege_count > 0) issues.push('Preflight role is not read-only for application schemas.')
      if (identity?.rolbypassrls) issues.push('Preflight role has BYPASSRLS; use a read-only audit role without row-security bypass.')
      const applicationRole = process.env.MARKETPLACE_DATABASE_USER
      const applicationRoleResult = await client.query(`
        SELECT role.rolname, role.rolsuper, role.rolcreatedb, role.rolcreaterole, role.rolreplication, role.rolbypassrls,
               EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace' AND has_schema_privilege(role.rolname, 'marketplace', 'USAGE')) AS marketplace_usage,
               EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace' AND has_schema_privilege(role.rolname, 'marketplace', 'CREATE')) AS marketplace_create,
               has_schema_privilege(role.rolname, 'public', 'CREATE') AS public_create
        FROM pg_roles AS role WHERE role.rolname = $1
      `, [applicationRole])
      const applicationRoleState = applicationRoleResult.rows[0]
      if (!applicationRoleState) issues.push('Configured runtime role does not exist on the target database.')
      if (applicationRoleState?.rolsuper || applicationRoleState?.rolcreatedb || applicationRoleState?.rolcreaterole || applicationRoleState?.rolreplication || applicationRoleState?.rolbypassrls) {
        issues.push('Configured runtime role has elevated PostgreSQL privileges.')
      }
      if (applicationRoleState?.marketplace_create || applicationRoleState?.public_create) issues.push('Configured runtime role has schema CREATE privileges.')
      const missingTables = await client.query(`
        SELECT required.table_name
        FROM unnest($1::text[]) AS required(table_name)
        WHERE to_regclass(format('%I.%I', 'marketplace', required.table_name)) IS NULL
        ORDER BY required.table_name
      `, [contracts.tables])
      const plannedTables = new Set(plannedChanges.createdTables ?? [])
      const unexpectedMissingTables = missingTables.rows.filter(({ table_name }) => !plannedTables.has(table_name))
      if (unexpectedMissingTables.length) issues.push(`Target is missing expected Marketplace tables: ${unexpectedMissingTables.map(({ table_name }) => table_name).join(', ')}.`)
      const liveColumns = await client.query(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'marketplace'
      `)
      const liveColumnKeys = new Set(liveColumns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`))
      const plannedColumns = new Set(plannedChanges.addedColumns ?? [])
      const missingColumns = contracts.columns.filter(({ table, column }) => !liveColumnKeys.has(`${table}.${column}`) && !plannedColumns.has(`${table}.${column}`))
      if (missingColumns.length) issues.push(`Target is missing expected Marketplace columns: ${missingColumns.map(({ table, column }) => `${table}.${column}`).join(', ')}.`)
      const sellerTermsColumnExists = liveColumnKeys.has('marketplace_seller_accounts.terms_accepted_at')
      if (!sellerTermsColumnExists && !plannedColumns.has('marketplace_seller_accounts.terms_accepted_at')) {
        issues.push('Marketplace seller terms acceptance column is missing.')
      }
      const missingPrivileges = await client.query(`
        SELECT required.table_name, required.privilege
        FROM unnest($1::text[], $2::text[]) AS required(table_name, privilege)
        WHERE to_regclass(format('%I.%I', 'marketplace', required.table_name)) IS NOT NULL
          AND NOT has_table_privilege($3, format('%I.%I', 'marketplace', required.table_name), required.privilege)
        ORDER BY required.table_name, required.privilege
      `, [contracts.privilegePairs.map((item) => item.table), contracts.privilegePairs.map((item) => item.privilege), applicationRole])
      if (missingPrivileges.rows.length) issues.push(`Configured runtime role lacks required application privileges: ${missingPrivileges.rows.map(({ table_name, privilege }) => `${table_name}:${privilege}`).join(', ')}.`)
      const roleAccess = await client.query(`
        SELECT roles.role_name,
               to_regrole(roles.role_name) IS NOT NULL AS role_exists,
               CASE WHEN to_regrole(roles.role_name) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace') THEN NULL
                    ELSE has_schema_privilege(roles.role_name, 'marketplace', 'USAGE') END AS schema_usage,
               CASE WHEN to_regrole(roles.role_name) IS NULL OR to_regclass('marketplace.marketplace_products') IS NULL THEN NULL
                    ELSE has_table_privilege(roles.role_name, 'marketplace.marketplace_products', 'SELECT') END AS product_read
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']::text[]) AS roles(role_name)
      `)
      if (roleAccess.rows.some(({ role_name, schema_usage, product_read }) => ['anon', 'authenticated'].includes(role_name) && (schema_usage || product_read))) {
        issues.push('Anonymous or authenticated Supabase roles can access Marketplace data.')
      }
      const rlsResult = await client.query(`
        SELECT relation.relname AS table_name, relation.relrowsecurity AS rls_enabled,
               relation.relforcerowsecurity AS force_rls,
               COALESCE(array_agg(policy.polname) FILTER (WHERE policy.polname IS NOT NULL), ARRAY[]::name[]) AS policies
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_policy AS policy ON policy.polrelid = relation.oid
        WHERE namespace.nspname = 'marketplace' AND relation.relkind = 'r'
        GROUP BY relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
        ORDER BY relation.relname
      `)
      const liveRls = new Map(rlsResult.rows.map((row) => [row.table_name, { enabled: row.rls_enabled, policies: [...row.policies].sort() }]))
      const rlsDrift = contracts.rlsContracts.filter((expected) => {
        const actual = liveRls.get(expected.table)
        return !actual || actual.enabled !== expected.enabled || JSON.stringify(actual.policies) !== JSON.stringify(expected.policies)
      })
      if (rlsDrift.length) issues.push(`Marketplace RLS/policy definitions differ from the approved snapshot: ${rlsDrift.map(({ table }) => table).join(', ')}.`)
      const publicSchemaFingerprint = (await client.query(publicFingerprintQuery)).rows[0]
      const ledgerAccess = await client.query(`
        SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
               CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                    ELSE has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT') END AS can_read_ledger,
               CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                    ELSE (has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT')
                      OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE')
                      OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE')
                      OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRUNCATE')) END AS can_write_ledger
      `)
        if (!ledgerAccess.rows[0]?.ledger_exists || !ledgerAccess.rows[0]?.can_read_ledger || ledgerAccess.rows[0]?.can_write_ledger) {
          issues.push('Preflight database role must be able to read, but not modify, the Supabase migration ledger.')
      }
      const ledgerSummary = ledgerAccess.rows[0]?.ledger_exists
        ? (await client.query(`SELECT count(*)::integer AS count, max(version)::text AS latest FROM supabase_migrations.schema_migrations`)).rows[0]
        : { count: null, latest: null }
      return {
        identity: {
          database: identity?.database_name,
          role: identity?.role_name,
          host: parsed.url.hostname,
          marketplaceSchemaExists: identity?.marketplace_schema_exists,
          marketplaceUsage: identity?.marketplace_usage,
          marketplaceCreate: identity?.marketplace_create,
          publicCreate: identity?.public_create,
          publicTablePrivilegeCount: identity?.public_table_privilege_count,
          superuser: identity?.rolsuper,
          createDatabase: identity?.rolcreatedb,
          createRole: identity?.rolcreaterole,
          replication: identity?.rolreplication,
          bypassRls: identity?.rolbypassrls,
        },
        runtimeRole: applicationRoleState,
        supabaseRoles: roleAccess.rows,
        rls: rlsResult.rows,
        marketplaceSellerTermsColumnExists: sellerTermsColumnExists,
        publicSchemaFingerprint: publicSchemaFingerprint?.fingerprint ?? null,
        publicSchemaDefinitionCount: publicSchemaFingerprint?.definition_count ?? 0,
        supabaseMigrationLedger: { exists: ledgerAccess.rows[0]?.ledger_exists, ...ledgerSummary },
      }
    }

    if (label === 'runtime') {
      if (!identity?.marketplace_usage) issues.push('Runtime role lacks USAGE on marketplace.')
      if (identity?.marketplace_create) issues.push('Runtime role has CREATE on marketplace; use a separate migration role.')
      if (identity?.public_table_privilege_count > 0) issues.push(`Runtime role has DML access to ${identity.public_table_privilege_count} public-schema relations; MarketHub runtime must remain isolated from Kitz.`)
      if (identity?.rolbypassrls) issues.push('Runtime role has BYPASSRLS; verify and remove unless a reviewed requirement justifies it.')
      const missingTables = await client.query(`
        SELECT required.table_name
        FROM unnest($1::text[]) AS required(table_name)
        WHERE to_regclass(format('%I.%I', 'marketplace', required.table_name)) IS NULL
        ORDER BY required.table_name
      `, [contracts.tables])
      const plannedTables = new Set(plannedChanges.createdTables ?? [])
      const unexpectedMissingTables = missingTables.rows.filter(({ table_name }) => !plannedTables.has(table_name))
      if (unexpectedMissingTables.length) issues.push(`Runtime target is missing expected Marketplace tables: ${unexpectedMissingTables.map(({ table_name }) => table_name).join(', ')}.`)
      const missingPrivileges = await client.query(`
        SELECT required.table_name, required.privilege
        FROM unnest($1::text[], $2::text[]) AS required(table_name, privilege)
        WHERE to_regclass(format('%I.%I', 'marketplace', required.table_name)) IS NOT NULL
          AND NOT has_table_privilege(current_user, format('%I.%I', 'marketplace', required.table_name), required.privilege)
        ORDER BY required.table_name, required.privilege
      `, [contracts.privilegePairs.map((item) => item.table), contracts.privilegePairs.map((item) => item.privilege)])
      if (missingPrivileges.rows.length) issues.push(`Runtime role lacks required application privileges: ${missingPrivileges.rows.map(({ table_name, privilege }) => `${table_name}:${privilege}`).join(', ')}.`)
      const liveColumns = await client.query(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'marketplace'
      `)
      const liveColumnKeys = new Set(liveColumns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`))
      const plannedColumns = new Set(plannedChanges.addedColumns ?? [])
      const missingColumns = contracts.columns.filter(({ table, column }) => !liveColumnKeys.has(`${table}.${column}`) && !plannedColumns.has(`${table}.${column}`))
      if (missingColumns.length) issues.push(`Marketplace columns missing from the live schema: ${missingColumns.map(({ table, column }) => `${table}.${column}`).join(', ')}.`)
      const sellerTermsColumnExists = liveColumnKeys.has('marketplace_seller_accounts.terms_accepted_at')
      if (!sellerTermsColumnExists && !plannedColumns.has('marketplace_seller_accounts.terms_accepted_at')) {
        issues.push('Marketplace seller terms acceptance column is missing and is not covered by the approved plan.')
      }

      const liveObjects = await client.query(`
        SELECT 'index'::text AS kind, index_relation.relname AS object_name
        FROM pg_index AS index_row
        JOIN pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
        JOIN pg_class AS table_relation ON table_relation.oid = index_row.indrelid
        JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
        WHERE namespace.nspname = 'marketplace'
        UNION ALL
        SELECT CASE constraint_row.contype WHEN 'f' THEN 'foreignKey' WHEN 'c' THEN 'checkConstraint' WHEN 'u' THEN 'uniqueConstraint' ELSE 'otherConstraint' END,
               constraint_row.conname
        FROM pg_constraint AS constraint_row
        JOIN pg_class AS table_relation ON table_relation.oid = constraint_row.conrelid
        JOIN pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
        WHERE namespace.nspname = 'marketplace'
      `)
      const liveObjectNames = new Map()
      for (const row of liveObjects.rows) liveObjectNames.set(row.kind, [...(liveObjectNames.get(row.kind) ?? []), row.object_name])
      const objectContracts = [
        ['index', contracts.indexes],
        ['foreignKey', contracts.foreignKeys],
        ['checkConstraint', contracts.checkConstraints],
        ['uniqueConstraint', contracts.uniqueConstraints],
      ]
      const missingSchemaObjects = []
      for (const [kind, expectedNames] of objectContracts) {
        const present = new Set(liveObjectNames.get(kind) ?? [])
        for (const name of expectedNames) if (!present.has(name)) missingSchemaObjects.push(`${kind}:${name}`)
      }
      if (missingSchemaObjects.length) issues.push(`Marketplace indexes/constraints/foreign keys missing from the live schema: ${missingSchemaObjects.join(', ')}.`)

      const roleAccess = await client.query(`
        SELECT roles.role_name,
               to_regrole(roles.role_name) IS NOT NULL AS role_exists,
               CASE WHEN to_regrole(roles.role_name) IS NULL OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'marketplace') THEN NULL
                    ELSE has_schema_privilege(roles.role_name, 'marketplace', 'USAGE') END AS schema_usage,
               CASE WHEN to_regrole(roles.role_name) IS NULL OR to_regclass('marketplace.marketplace_products') IS NULL THEN NULL
                    ELSE has_table_privilege(roles.role_name, 'marketplace.marketplace_products', 'SELECT') END AS product_read
        FROM unnest(ARRAY['anon', 'authenticated', 'service_role']::text[]) AS roles(role_name)
      `)
      const publicRoles = roleAccess.rows.filter(({ role_name, schema_usage, product_read }) => ['anon', 'authenticated'].includes(role_name) && (schema_usage || product_read))
      if (publicRoles.length) issues.push(`Anonymous/authenticated Supabase roles can access Marketplace data: ${publicRoles.map(({ role_name }) => role_name).join(', ')}.`)

      const rlsResult = await client.query(`
        SELECT relation.relname AS table_name, relation.relrowsecurity AS rls_enabled,
               relation.relforcerowsecurity AS force_rls,
               COALESCE(array_agg(policy.polname) FILTER (WHERE policy.polname IS NOT NULL), ARRAY[]::name[]) AS policies
        FROM pg_class AS relation
        JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        LEFT JOIN pg_policy AS policy ON policy.polrelid = relation.oid
        WHERE namespace.nspname = 'marketplace' AND relation.relkind = 'r'
        GROUP BY relation.relname, relation.relrowsecurity, relation.relforcerowsecurity
        ORDER BY relation.relname
      `)
      const publicSchemaFingerprint = (await client.query(publicFingerprintQuery)).rows[0]
      const ledgerExists = (await client.query(`SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS exists`)).rows[0]?.exists === true
      let ledger = { exists: ledgerExists, count: null, latest: null }
      if (ledgerExists) {
        const ledgerResult = await client.query(`SELECT count(*)::integer AS count, max(version)::text AS latest FROM supabase_migrations.schema_migrations`)
        ledger = { exists: true, ...ledgerResult.rows[0] }
      }
      return {
        identity: {
          database: identity?.database_name,
          role: identity?.role_name,
          host: parsed.url.hostname,
          marketplaceSchemaExists: identity?.marketplace_schema_exists,
          marketplaceUsage: identity?.marketplace_usage,
          marketplaceCreate: identity?.marketplace_create,
          publicUsage: identity?.public_usage,
          publicCreate: identity?.public_create,
          publicTablePrivilegeCount: identity?.public_table_privilege_count,
          superuser: identity?.rolsuper,
          createDatabase: identity?.rolcreatedb,
          createRole: identity?.rolcreaterole,
          replication: identity?.rolreplication,
          bypassRls: identity?.rolbypassrls,
        },
        supabaseRoles: roleAccess.rows,
        rls: rlsResult.rows,
        marketplaceSellerTermsColumnExists: sellerTermsColumnExists,
        publicSchemaFingerprint: publicSchemaFingerprint?.fingerprint ?? null,
        publicSchemaDefinitionCount: publicSchemaFingerprint?.definition_count ?? 0,
        supabaseMigrationLedger: ledger,
      }
    }

    if (!identity?.marketplace_schema_exists || !identity?.marketplace_create) issues.push('Migration role must have CREATE on marketplace before an approved migration.')
    if (identity?.public_create) issues.push('Migration role must not have CREATE on public.')
    if (identity?.public_table_privilege_count > 0) issues.push(`Migration role has DML access to ${identity.public_table_privilege_count} public-schema relations.`)
    if (identity?.marketplace_usage !== true) issues.push('Migration role must have USAGE on marketplace.')
    const ledgerPrivilege = await client.query(`
      SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS ledger_exists,
             CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                  ELSE has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'SELECT') END AS can_read_ledger,
             CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN false
                  ELSE (has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'INSERT')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'UPDATE')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'DELETE')
                    OR has_table_privilege(current_user, 'supabase_migrations.schema_migrations', 'TRUNCATE')) END AS can_write_ledger
    `)
    const ledger = ledgerPrivilege.rows[0]
    if (!ledger?.ledger_exists || !ledger?.can_read_ledger || ledger?.can_write_ledger) issues.push('Migration role must read, but must not modify, the Supabase migration ledger.')
    return {
      identity: {
        database: identity?.database_name,
        role: identity?.role_name,
        host: parsed.url.hostname,
        marketplaceSchemaExists: identity?.marketplace_schema_exists,
        marketplaceUsage: identity?.marketplace_usage,
        marketplaceCreate: identity?.marketplace_create,
        publicUsage: identity?.public_usage,
        publicCreate: identity?.public_create,
        publicTablePrivilegeCount: identity?.public_table_privilege_count,
        superuser: identity?.rolsuper,
        createDatabase: identity?.rolcreatedb,
        createRole: identity?.rolcreaterole,
        replication: identity?.rolreplication,
        bypassRls: identity?.rolbypassrls,
      },
      supabaseMigrationLedger: ledger,
    }
  } finally {
    await client.end()
  }
}

async function main() {
  const options = getOptions()
  const issues = []
  const warnings = []
  const preflightOnly = process.env.MARKETHUB_PREFLIGHT_ONLY === 'true'
  const expected = {
    databaseName: process.env.MARKETPLACE_DATABASE_NAME,
    host: process.env.MARKETPLACE_DATABASE_HOST,
    schema: process.env.MARKETPLACE_DATABASE_SCHEMA,
  }
  const supabaseConfig = await readFile(path.join(repositoryDir, 'supabase', 'config.toml'), 'utf8')
  const expectedProjectRef = supabaseConfig.match(/^project_id\s*=\s*"([a-z0-9]+)"/mi)?.[1]
  if (expected.databaseName !== 'postgres') issues.push('MARKETPLACE_DATABASE_NAME must be postgres for the shared Supabase project.')
  if (expected.schema !== 'marketplace') issues.push('MARKETPLACE_DATABASE_SCHEMA must be exactly marketplace.')
  if (!expected.host) issues.push('MARKETPLACE_DATABASE_HOST is required.')
  if (!expectedProjectRef) issues.push('Supabase project_id is missing from supabase/config.toml.')
  if (!process.env.MARKETPLACE_DATABASE_USER) issues.push('MARKETPLACE_DATABASE_USER is required.')
  if (preflightOnly) {
    if (!process.env.MARKETHUB_PREFLIGHT_DATABASE_URL) issues.push('MARKETHUB_PREFLIGHT_DATABASE_URL is required for read-only preflight.')
  } else if (!process.env.MARKETPLACE_DATABASE_URL || !process.env.MARKETPLACE_MIGRATION_DATABASE_URL) {
    issues.push('Separate runtime and migration database URLs are required.')
  }
  if (issues.length) throw new Error(issues.join('\n'))

  const runtime = preflightOnly ? null : parseDatabaseUrl(process.env.MARKETPLACE_DATABASE_URL, 'MARKETPLACE_DATABASE_URL')
  const migrationUrl = preflightOnly ? process.env.MARKETHUB_PREFLIGHT_DATABASE_URL : process.env.MARKETPLACE_MIGRATION_DATABASE_URL
  const migration = parseDatabaseUrl(migrationUrl, preflightOnly ? 'MARKETHUB_PREFLIGHT_DATABASE_URL' : 'MARKETPLACE_MIGRATION_DATABASE_URL')
  const hasProjectIdentity = (connection) => connection.url.hostname.toLowerCase().includes(expectedProjectRef ?? '') || connection.user.includes(expectedProjectRef ?? '')
  if (!hasProjectIdentity(migration)) issues.push('Preflight/migration URL does not identify the Supabase project configured in supabase/config.toml.')
  if (runtime && runtime.user !== decodeURIComponent(process.env.MARKETPLACE_DATABASE_USER)) issues.push('Runtime URL role does not match MARKETPLACE_DATABASE_USER.')
  if (runtime && !hasProjectIdentity(runtime)) issues.push('Runtime URL does not identify the Supabase project configured in supabase/config.toml.')
  if (preflightOnly && migration.user === decodeURIComponent(process.env.MARKETPLACE_DATABASE_USER)) issues.push('Read-only preflight URL must use a separate role from the application runtime.')
  if (runtime && runtime.user === migration.user) issues.push('Runtime and migration URLs must use distinct database roles.')
  if (runtime && (runtime.database !== migration.database || runtime.url.hostname.toLowerCase() !== migration.url.hostname.toLowerCase())) issues.push('Runtime and migration URLs must target the same database and host.')
  if (migration.database !== expected.databaseName || migration.url.hostname.toLowerCase() !== expected.host.toLowerCase()) issues.push('Database connection URL does not match the configured Supabase database and host.')
  const ca = process.env.MARKETPLACE_DATABASE_CA?.replaceAll('\\n', '\n') || ''
  if (process.env.NODE_ENV === 'production' && !ca) issues.push('MARKETPLACE_DATABASE_CA is required for verified TLS.')
  if (issues.length) throw new Error(issues.join('\n'))

  const schemaSource = await readFile(path.join(platformDir, 'server', 'src', 'database', 'schema.ts'), 'utf8')
  const appSource = await readFile(path.join(platformDir, 'server', 'src', 'app.ts'), 'utf8')
  const latestSnapshot = JSON.parse(await readFile(path.join(platformDir, 'server', 'src', 'database', 'marketplace-migrations', 'meta', '0007_snapshot.json'), 'utf8'))
  const contracts = parseApplicationContracts(schemaSource, appSource, latestSnapshot)
  if (JSON.stringify(contracts.tables) !== JSON.stringify(contracts.healthTables)) issues.push('Drizzle schema tables do not match the /health/ready relation contract.')
  let plannedChanges = { createdTables: [], addedColumns: [] }
  const manifestValidationPath = process.env.MARKETHUB_POSTFLIGHT === 'true' ? undefined : process.env.MARKETHUB_MANIFEST_VALIDATION_FILE
  if (manifestValidationPath) {
    const manifestValidation = JSON.parse(await readFile(manifestValidationPath, 'utf8'))
    if (!manifestValidation.valid || manifestValidation.errors?.length) issues.push('MarketHub migration manifest validation did not pass.')
    else plannedChanges = manifestValidation.plannedChanges ?? plannedChanges
  }
  if (issues.length) throw new Error(issues.join('\n'))

  const runtimeReport = runtime ? await inspectConnection('runtime', runtime, expected, ca, contracts, issues, plannedChanges) : null
  const connectionReport = await inspectConnection(preflightOnly ? 'preflight' : 'migration', migration, expected, ca, contracts, issues, plannedChanges)
  if (process.env.MARKETHUB_POSTFLIGHT !== 'true' && connectionReport.marketplaceSellerTermsColumnExists === false
    && plannedChanges.addedColumns.includes('marketplace_seller_accounts.terms_accepted_at')) {
    warnings.push('Seller terms acceptance column is absent before migration and is covered by the approved Marketplace manifest.')
  }
  const runtimeFingerprint = runtimeReport?.publicSchemaFingerprint ?? connectionReport.publicSchemaFingerprint
  const comparePath = options.comparePath
  if (comparePath) {
    const baseline = JSON.parse(await readFile(comparePath, 'utf8'))
    if (!baseline.publicSchemaFingerprint || baseline.publicSchemaFingerprint !== runtimeFingerprint) {
      issues.push('Kitz public schema fingerprint changed during the MarketHub migration window.')
    }
  }
  const report = {
    checkedAt: new Date().toISOString(),
    readOnly: true,
    target: { projectRef: expectedProjectRef, databaseName: expected.databaseName, host: expected.host, schema: expected.schema },
    runtime: runtimeReport,
    [preflightOnly ? 'preflight' : 'migration']: connectionReport,
    marketplaceExpectedTableCount: contracts.tables.length,
    marketplaceTableSetMatchesHealth: JSON.stringify(contracts.tables) === JSON.stringify(contracts.healthTables),
    marketplaceSellerTermsColumnExists: connectionReport.marketplaceSellerTermsColumnExists ?? runtimeReport?.marketplaceSellerTermsColumnExists ?? null,
    plannedChanges,
    publicSchemaFingerprint: runtimeFingerprint,
    status: issues.length ? 'blocked' : warnings.length ? 'warning' : 'passed',
    issues,
    warnings,
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  if (options.reportPath) await writeFile(options.reportPath, serialized, 'utf8')
  if (options.baselinePath) await writeFile(options.baselinePath, serialized, 'utf8')
  process.stdout.write(`Database preflight: ${report.status}\n`)
  process.stdout.write(`Target: ${expected.databaseName} @ ${expected.host} / ${expected.schema}\n`)
  process.stdout.write(`Runtime role: ${runtimeReport?.identity.role ?? process.env.MARKETPLACE_DATABASE_USER}; ${preflightOnly ? 'preflight' : 'migration'} role: ${connectionReport.identity.role}\n`)
  process.stdout.write(`Expected tables: ${contracts.tables.length}; migration ledger latest: ${connectionReport.supabaseMigrationLedger?.latest ?? 'not available'}\n`)
  for (const issue of issues) process.stderr.write(`BLOCKER: ${issue}\n`)
  for (const warning of warnings) process.stderr.write(`WARNING: ${warning}\n`)
  if (issues.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(async (error) => {
    let message = error instanceof Error ? error.message : 'unknown error'
    for (const [name, value] of Object.entries(process.env)) {
      if (value && /URL|TOKEN|PASSWORD|SECRET|API_KEY|CA/i.test(name)) message = message.split(value).join('[REDACTED]')
    }
    message = message.replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, '[REDACTED DATABASE URL]').replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    const reportPath = getOptions().reportPath
    if (reportPath) {
      const report = {
        checkedAt: new Date().toISOString(),
        readOnly: true,
        status: 'blocked',
        target: {
          databaseName: process.env.MARKETPLACE_DATABASE_NAME ?? null,
          host: process.env.MARKETPLACE_DATABASE_HOST ?? null,
          schema: process.env.MARKETPLACE_DATABASE_SCHEMA ?? null,
        },
        issues: message.split(/\r?\n/).filter(Boolean),
        warnings: [],
      }
      await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8').catch(() => {})
    }
    process.stderr.write(`Database preflight failed: ${message}\n`)
    process.exitCode = 1
  })
}