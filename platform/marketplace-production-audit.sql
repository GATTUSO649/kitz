-- READ-ONLY MarketHub production audit for Supabase SQL Editor.
-- This script contains SELECT statements only. It does not create objects,
-- modify privileges, or change records.
-- Before running, replace the role name below with the exact
-- MARKETPLACE_DATABASE_USER value configured for the Render runtime.
-- Do not paste a password, connection URL, token, or certificate here.

WITH
parameters AS (
  SELECT 'REPLACE_WITH_MARKETPLACE_DATABASE_USER'::text AS application_role
),
role_state AS (
  SELECT
    application_role,
    to_regrole(application_role)::oid AS role_oid
  FROM parameters
),
schema_state AS (
  SELECT
    namespace.oid AS schema_oid,
    namespace.nspowner AS owner_oid,
    pg_get_userbyid(namespace.nspowner) AS owner_name
  FROM pg_namespace AS namespace
  WHERE namespace.nspname = 'marketplace'
),
expected_tables(table_name) AS (
  VALUES
    ('marketplace_admin_invitations'),
    ('marketplace_admin_sessions'),
    ('marketplace_admin_users'),
    ('marketplace_admin_verification_tokens'),
    ('marketplace_audit_logs'),
    ('marketplace_categories'),
    ('marketplace_contact_unlocks'),
    ('marketplace_counties'),
    ('marketplace_email_events'),
    ('marketplace_featured_products'),
    ('marketplace_notifications'),
    ('marketplace_payment_callbacks'),
    ('marketplace_payments'),
    ('marketplace_product_access'),
    ('marketplace_product_images'),
    ('marketplace_product_reports'),
    ('marketplace_product_views'),
    ('marketplace_products'),
    ('marketplace_seller_accounts'),
    ('marketplace_seller_password_reset_tokens'),
    ('marketplace_seller_sessions'),
    ('marketplace_seller_verification_tokens'),
    ('marketplace_sellers'),
    ('marketplace_settings'),
    ('marketplace_subcategories')
),
expected_privileges(table_name, privilege) AS (
  VALUES
    ('marketplace_admin_sessions', 'SELECT'), ('marketplace_admin_sessions', 'INSERT'), ('marketplace_admin_sessions', 'DELETE'),
    ('marketplace_admin_users', 'SELECT'), ('marketplace_admin_users', 'INSERT'), ('marketplace_admin_users', 'UPDATE'),
    ('marketplace_audit_logs', 'SELECT'), ('marketplace_audit_logs', 'INSERT'),
    ('marketplace_categories', 'SELECT'), ('marketplace_categories', 'INSERT'), ('marketplace_categories', 'UPDATE'),
    ('marketplace_contact_unlocks', 'SELECT'), ('marketplace_contact_unlocks', 'INSERT'),
    ('marketplace_counties', 'SELECT'),
    ('marketplace_email_events', 'SELECT'), ('marketplace_email_events', 'INSERT'), ('marketplace_email_events', 'UPDATE'),
    ('marketplace_payments', 'SELECT'), ('marketplace_payments', 'INSERT'), ('marketplace_payments', 'UPDATE'),
    ('marketplace_payment_callbacks', 'SELECT'), ('marketplace_payment_callbacks', 'INSERT'), ('marketplace_payment_callbacks', 'UPDATE'),
    ('marketplace_product_access', 'SELECT'), ('marketplace_product_access', 'INSERT'), ('marketplace_product_access', 'DELETE'),
    ('marketplace_product_images', 'SELECT'), ('marketplace_product_images', 'INSERT'), ('marketplace_product_images', 'UPDATE'), ('marketplace_product_images', 'DELETE'),
    ('marketplace_product_reports', 'SELECT'), ('marketplace_product_reports', 'INSERT'), ('marketplace_product_reports', 'UPDATE'),
    ('marketplace_product_views', 'INSERT'),
    ('marketplace_products', 'SELECT'), ('marketplace_products', 'INSERT'), ('marketplace_products', 'UPDATE'),
    ('marketplace_seller_accounts', 'SELECT'), ('marketplace_seller_accounts', 'INSERT'), ('marketplace_seller_accounts', 'UPDATE'),
    ('marketplace_seller_password_reset_tokens', 'SELECT'), ('marketplace_seller_password_reset_tokens', 'INSERT'), ('marketplace_seller_password_reset_tokens', 'UPDATE'),
    ('marketplace_seller_sessions', 'SELECT'), ('marketplace_seller_sessions', 'INSERT'), ('marketplace_seller_sessions', 'DELETE'),
    ('marketplace_seller_verification_tokens', 'SELECT'), ('marketplace_seller_verification_tokens', 'INSERT'), ('marketplace_seller_verification_tokens', 'UPDATE'),
    ('marketplace_sellers', 'SELECT'), ('marketplace_sellers', 'INSERT'), ('marketplace_sellers', 'UPDATE'),
    ('marketplace_settings', 'SELECT'), ('marketplace_settings', 'INSERT'), ('marketplace_settings', 'UPDATE')
),
all_dml(privilege) AS (
  VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
),
table_privilege_report AS (
  SELECT
    expected.table_name,
    dml.privilege,
    required.table_name IS NOT NULL AS required_by_runtime,
    CASE
      WHEN relation.oid IS NULL THEN NULL
      WHEN role.role_oid IS NULL THEN NULL
      ELSE has_table_privilege(role.role_oid, relation.oid, dml.privilege)
    END AS granted,
    CASE
      WHEN relation.oid IS NULL THEN 'TABLE_MISSING'
      WHEN role.role_oid IS NULL THEN 'APPLICATION_ROLE_NOT_FOUND'
      WHEN has_table_privilege(role.role_oid, relation.oid, dml.privilege) THEN 'GRANTED'
      WHEN required.table_name IS NOT NULL THEN 'REQUIRED_PRIVILEGE_MISSING'
      ELSE 'NOT_GRANTED_NOT_REQUIRED_BY_CURRENT_RUNTIME_PATHS'
    END AS result
  FROM expected_tables AS expected
  CROSS JOIN all_dml AS dml
  CROSS JOIN role_state AS role
  LEFT JOIN expected_privileges AS required
    ON required.table_name = expected.table_name
   AND required.privilege = dml.privilege
  LEFT JOIN LATERAL (
    SELECT to_regclass(format('%I.%I', 'marketplace', expected.table_name))::oid AS oid
  ) AS relation ON true
),
expected_migrations(migration_order, tag, applied_at, local_sha256) AS (
  VALUES
    (0, '0000_slippery_khan', 1793905383904::bigint, '9fde107da1d6116954e7ead89a5ee2b6673bec53ca4cd73cc634fd2a2515725a'),
    (1, '0001_round_hellfire_club', 1793905568058::bigint, '728e41c0942fbefda6ea31065f6bd45fb39051b06dd6dc1737c6a55bda5e8a61'),
    (2, '0002_faulty_blazing_skull', 1793917364294::bigint, 'd7940347753c27608eba51d7d35a69cfdc7a8889a0d65c2f9c380c42731a9224'),
    (3, '0003_accounts_and_verification', 1793951102537::bigint, '84531d606ecbd83946a9c795d34c66944c7f244dc0e31c79c9451a1bc81684df'),
    (4, '0004_admin_verification_tokens', 1793951645231::bigint, '630a700213a478b972aa19d348ba5371448c5c0c85ba739ea432daa605370c2c'),
    (5, '0005_central_admin_payments_seller_recovery', 1793958048256::bigint, 'b156bd4c90fb81d4b05cd8116379a470f183329553fc39b9f9c68f247cd0208c')
),
ledger_state AS (
  SELECT
    to_regclass('marketplace.__drizzle_migrations')::oid AS relation_oid,
    CASE
      WHEN to_regclass('marketplace.__drizzle_migrations') IS NULL THEN false
      ELSE (
        SELECT
          count(*) FILTER (WHERE attribute.attname = 'id' AND format_type(attribute.atttypid, attribute.atttypmod) = 'integer') = 1
          AND count(*) FILTER (WHERE attribute.attname = 'hash' AND format_type(attribute.atttypid, attribute.atttypmod) = 'text') = 1
          AND count(*) FILTER (WHERE attribute.attname = 'created_at' AND format_type(attribute.atttypid, attribute.atttypmod) = 'bigint') = 1
        FROM pg_attribute AS attribute
        WHERE attribute.attrelid = to_regclass('marketplace.__drizzle_migrations')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      )
    END AS expected_layout
),
ledger_xml AS (
  SELECT CASE
    WHEN ledger.relation_oid IS NOT NULL AND ledger.expected_layout THEN
      query_to_xml(
        'SELECT id::bigint AS id, hash::text AS hash, created_at::bigint AS created_at FROM marketplace.__drizzle_migrations ORDER BY created_at, id',
        true,
        false,
        ''
      )
    ELSE NULL::xml
  END AS document
  FROM ledger_state AS ledger
),
ledger_rows AS (
  SELECT row_data.id, row_data.hash, row_data.created_at
  FROM ledger_xml
  CROSS JOIN LATERAL XMLTABLE(
    '/table/row'
    PASSING COALESCE(ledger_xml.document, '<table/>'::xml)
    COLUMNS
      id bigint PATH 'id',
      hash text PATH 'hash',
      created_at bigint PATH 'created_at'
  ) AS row_data
  WHERE ledger_xml.document IS NOT NULL
),
ledger_summary AS (
  SELECT max(created_at) AS latest_created_at, count(*) AS row_count
  FROM ledger_rows
),
migration_comparison AS (
  SELECT
    expected.migration_order,
    expected.tag,
    expected.applied_at,
    expected.local_sha256,
    count(actual.id) FILTER (WHERE actual.created_at = expected.applied_at) AS timestamp_match_count,
    COALESCE(bool_or(actual.hash = expected.local_sha256) FILTER (WHERE actual.created_at = expected.applied_at), false) AS local_hash_matches,
    array_agg(actual.hash ORDER BY actual.id) FILTER (WHERE actual.created_at = expected.applied_at) AS ledger_hashes,
    CASE
      WHEN ledger.relation_oid IS NULL THEN 'LEDGER_MISSING'
      WHEN NOT ledger.expected_layout THEN 'LEDGER_LAYOUT_MISMATCH'
      WHEN count(actual.id) FILTER (WHERE actual.created_at = expected.applied_at) > 1 THEN 'DUPLICATE_TIMESTAMP_ROWS'
      WHEN count(actual.id) FILTER (WHERE actual.created_at = expected.applied_at) = 1
        AND bool_or(actual.hash = expected.local_sha256) FILTER (WHERE actual.created_at = expected.applied_at) THEN 'APPLIED_HASH_MATCH'
      WHEN count(actual.id) FILTER (WHERE actual.created_at = expected.applied_at) = 1 THEN 'APPLIED_HASH_MISMATCH'
      WHEN summary.latest_created_at IS NOT NULL AND expected.applied_at <= summary.latest_created_at THEN 'MISSING_BEFORE_OR_AT_LATEST_LEDGER_ROW'
      ELSE 'PENDING_AFTER_LATEST_LEDGER_ROW'
    END AS status,
    CASE
      WHEN ledger.relation_oid IS NULL OR NOT ledger.expected_layout THEN NULL
      ELSE summary.latest_created_at IS NULL OR expected.applied_at > summary.latest_created_at
    END AS drizzle_would_apply_by_created_at
  FROM expected_migrations AS expected
  CROSS JOIN ledger_state AS ledger
  CROSS JOIN ledger_summary AS summary
  LEFT JOIN ledger_rows AS actual ON true
  GROUP BY expected.migration_order, expected.tag, expected.applied_at, expected.local_sha256,
    ledger.relation_oid, ledger.expected_layout, summary.latest_created_at
),
sequence_report AS (
  SELECT
    sequence.relname AS sequence_name,
    CASE WHEN role.role_oid IS NULL THEN NULL ELSE has_sequence_privilege(role.role_oid, sequence.oid, 'USAGE') END AS usage_granted,
    CASE WHEN role.role_oid IS NULL THEN NULL ELSE has_sequence_privilege(role.role_oid, sequence.oid, 'SELECT') END AS select_granted,
    CASE WHEN role.role_oid IS NULL THEN NULL ELSE has_sequence_privilege(role.role_oid, sequence.oid, 'UPDATE') END AS update_granted,
    false AS required_by_marketplace_runtime_schema
  FROM pg_class AS sequence
  JOIN pg_namespace AS namespace ON namespace.oid = sequence.relnamespace
  CROSS JOIN role_state AS role
  WHERE namespace.nspname = 'marketplace'
    AND sequence.relkind = 'S'
)
SELECT jsonb_pretty(jsonb_build_object(
  'safety', jsonb_build_object(
    'read_only', true,
    'database_changes_made', false,
    'database_url_or_password_read', false
  ),
  'database_context', jsonb_build_object(
    'current_database', current_database(),
    'expected_database', 'postgres',
    'database_name_matches_expected', current_database() = 'postgres',
    'sql_editor_current_user', current_user,
    'application_role_to_check', (SELECT application_role FROM role_state),
    'application_role_exists', (SELECT role_oid IS NOT NULL FROM role_state)
  ),
  'schema', jsonb_build_object(
    'name', 'marketplace',
    'exists', (SELECT schema_oid IS NOT NULL FROM schema_state),
    'owner', (SELECT owner_name FROM schema_state),
    'application_role_has_usage', (
      SELECT CASE
        WHEN role.role_oid IS NULL OR schema.schema_oid IS NULL THEN NULL
        ELSE has_schema_privilege(role.role_oid, schema.schema_oid, 'USAGE')
      END
      FROM role_state AS role
      LEFT JOIN schema_state AS schema ON true
    )
  ),
  'expected_table_summary', jsonb_build_object(
    'expected_count', (SELECT count(*) FROM expected_tables),
    'present_count', (SELECT count(*) FROM expected_tables AS expected WHERE to_regclass(format('%I.%I', 'marketplace', expected.table_name)) IS NOT NULL),
    'missing_count', (SELECT count(*) FROM expected_tables AS expected WHERE to_regclass(format('%I.%I', 'marketplace', expected.table_name)) IS NULL)
  ),
  'expected_tables', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', expected.table_name,
      'exists', to_regclass(format('%I.%I', 'marketplace', expected.table_name)) IS NOT NULL
    ) ORDER BY expected.table_name), '[]'::jsonb)
    FROM expected_tables AS expected
  ),
  'missing_expected_tables', (
    SELECT COALESCE(jsonb_agg(expected.table_name ORDER BY expected.table_name), '[]'::jsonb)
    FROM expected_tables AS expected
    WHERE to_regclass(format('%I.%I', 'marketplace', expected.table_name)) IS NULL
  ),
  'unexpected_tables', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('table', relation.relname) ORDER BY relation.relname), '[]'::jsonb)
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'marketplace'
      AND relation.relkind IN ('r', 'p')
      AND relation.relname <> '__drizzle_migrations'
      AND NOT EXISTS (SELECT 1 FROM expected_tables AS expected WHERE expected.table_name = relation.relname)
  ),
  'migration_ledger', jsonb_build_object(
    'qualified_name', 'marketplace.__drizzle_migrations',
    'exists', (SELECT relation_oid IS NOT NULL FROM ledger_state),
    'layout_matches_drizzle', (SELECT expected_layout FROM ledger_state),
    'expected_columns', jsonb_build_array('id integer', 'hash text', 'created_at bigint'),
    'ledger_row_count', (SELECT row_count FROM ledger_summary),
    'drizzle_runner_uses_created_at_threshold_not_hash_validation', true,
    'rows', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'hash', hash, 'created_at', created_at) ORDER BY created_at, id), '[]'::jsonb)
      FROM ledger_rows
    ),
    'expected_migration_comparison', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'order', migration_order,
        'tag', tag,
        'journal_when', applied_at,
        'status', status,
        'local_sha256', local_sha256,
        'ledger_hashes_at_expected_timestamp', ledger_hashes,
        'drizzle_would_apply_by_created_at', drizzle_would_apply_by_created_at
      ) ORDER BY migration_order), '[]'::jsonb)
      FROM migration_comparison
    ),
    'unmatched_ledger_rows', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('id', actual.id, 'hash', actual.hash, 'created_at', actual.created_at) ORDER BY actual.created_at, actual.id), '[]'::jsonb)
      FROM ledger_rows AS actual
      WHERE NOT EXISTS (SELECT 1 FROM expected_migrations AS expected WHERE expected.applied_at = actual.created_at)
    )
  ),
  'table_privileges', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', table_name,
      'privilege', privilege,
      'required_by_current_runtime_paths', required_by_runtime,
      'granted', granted,
      'result', result
    ) ORDER BY table_name, privilege), '[]'::jsonb)
    FROM table_privilege_report
  ),
  'missing_required_table_privileges', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('table', table_name, 'privilege', privilege) ORDER BY table_name, privilege), '[]'::jsonb)
    FROM table_privilege_report
    WHERE required_by_runtime AND granted IS NOT TRUE
  ),
  'sequences', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'sequence', sequence_name,
      'usage_granted_to_application_role', usage_granted,
      'select_granted_to_application_role', select_granted,
      'update_granted_to_application_role', update_granted,
      'required_by_marketplace_runtime_schema', required_by_marketplace_runtime_schema
    ) ORDER BY sequence_name), '[]'::jsonb)
    FROM sequence_report
  ),
  'sequence_note', 'Current marketplace Drizzle schema uses UUID keys and declares no application-owned sequences. The __drizzle_migrations serial sequence is for the migration role, not the runtime application role.'
)) AS marketplace_production_audit;
