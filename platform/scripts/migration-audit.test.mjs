import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inspectMigration, parseSupabaseMigrationLedger } from './migration-audit.mjs'

test('migration audit identifies marketplace tables, indexes, constraints, foreign keys, policies and RLS', () => {
  const result = inspectMigration('20261108000000_marketplace_example.sql', `
    CREATE TABLE "marketplace"."marketplace_example" (id uuid PRIMARY KEY);
    CREATE INDEX "marketplace_example_id_idx" ON "marketplace"."marketplace_example" (id);
    ALTER TABLE "marketplace"."marketplace_example" ADD CONSTRAINT "marketplace_example_fk" FOREIGN KEY (id) REFERENCES "marketplace"."marketplace_products" (id);
    ALTER TABLE "marketplace"."marketplace_example" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "marketplace_example_read" ON "marketplace"."marketplace_example" FOR SELECT TO authenticated USING (true);
  `)

  assert.deepEqual(result.schemas, ['marketplace'])
  assert.deepEqual(result.tableCreates, ['marketplace_example'])
  assert.equal(result.indexes, 1)
  assert.equal(result.constraints, 1)
  assert.equal(result.foreignKeys, 1)
  assert.equal(result.policies, 1)
  assert.equal(result.enablesRls, 1)
})

test('migration audit treats unqualified objects as public and reports destructive statements', () => {
  const result = inspectMigration('20261108000001_marketplace_bad.sql', `
    -- DELETE FROM marketplace.marketplace_products is only a comment.
    CREATE TABLE "products" (id uuid PRIMARY KEY);
    ALTER TABLE "marketplace"."marketplace_products" DROP COLUMN "legacy";
  `)

  assert.ok(result.schemas.includes('public (unqualified)'))
  assert.ok(result.schemas.includes('marketplace'))
  assert.deepEqual(result.riskyOperations, ['DROP'])
})

test('migration audit detects dynamic public RLS changes and public-wide policies', () => {
  const result = inspectMigration('20261108000002_marketplace_unsafe.sql', `
    DO $$ BEGIN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_record.tablename);
    END $$;
    CREATE POLICY "unsafe" ON "marketplace"."marketplace_products" FOR ALL TO anon USING (true);
    ALTER POLICY "seller_update" ON "marketplace"."marketplace_products" USING (true);
  `)

  assert.ok(result.schemas.includes('public (dynamic)'))
  assert.equal(result.disablesRls, 0)
  assert.equal(result.hasPublicPolicy, true)
  assert.ok(result.riskyOperations.includes('ALTER_POLICY'))
  assert.ok(result.targets.some(({ schema, name }) => schema === 'marketplace' && name === 'marketplace_products'))
})

test('Supabase ledger parser identifies applied, pending, and remote-only migration versions', () => {
  assert.deepEqual(parseSupabaseMigrationLedger(`
    LOCAL      │     REMOTE     │ TIME (UTC)
    ───────────┼────────────────┼──────────────────────
    20261103000000 │ 20261103000000 │ 2026-11-03 00:00:00
                   │ 20261105000000 │ 2026-11-05 00:00:00
    20261108000000 │                │
  `), [
    { local: '20261103000000', remote: '20261103000000' },
    { local: null, remote: '20261105000000' },
    { local: '20261108000000', remote: null },
  ])
})