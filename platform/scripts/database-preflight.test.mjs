import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runtimeSequencePrivilegeIssues } from './database-preflight.mjs'

test('database preflight rejects missing sequence usage and runtime-owned sequences', () => {
  const issues = runtimeSequencePrivilegeIssues([
    { name: 'payments_id_seq', owner: 'migration_role', canUse: false },
    { name: 'sellers_id_seq', owner: 'runtime_role', canUse: true },
    { name: 'products_id_seq', owner: 'migration_role', canUse: true },
  ], 'runtime_role')

  assert.deepEqual(issues, [
    'Runtime role lacks USAGE on Marketplace sequence payments_id_seq.',
    'Runtime role owns Marketplace sequence sellers_id_seq.',
  ])
})
