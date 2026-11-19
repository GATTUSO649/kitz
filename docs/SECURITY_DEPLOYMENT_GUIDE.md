# Security Deployment Guide

## Current state

Kitz and MarketHub remain separate deployments and databases. The Operations WAF defaults to `WAF_MODE=detect`. Operations sign-in uses active, email-verified IT Admin and Super Admin accounts; no separate Operations password, grant, or feature flag is required. The MarketHub payment feed is disabled until its exact URL and shared service token are configured in server environments. The service token must never be exposed to Vite/browser variables.

## Required before any production change

- Reconcile current remote migration ledgers and verify the actual target project; the local `.env` database target is unverified and was not read or contacted.
- Obtain explicit database-owner approval, current backup, verified restore, isolated staging, supported PostgreSQL version, schema privileges, and TLS CA.
- Validate all pending migrations in order and inspect the complete Supabase dry-run set. Current source migrations 0013/0014 are not present in the Supabase stream.
- Pass Kitz and MarketHub tests/builds, database-backed bridge/payment-feed tests, and two-instance Redis tests.
- Verify exact origins, service token rotation/ownership, feed URL same-origin, WAF detect-mode false positives, worker persistence, and provider health integrations.
- Keep bridge exchange disabled during schema migration. Enable only in a separate approved release after staging verification and explicit grant review.
- Keep WAF in detection mode until an approved staging exercise and false-positive review support any block-mode change.

## Do not

Do not run migrations against the unverified `DATABASE_URL`, disable production Redis, run live charges for testing, change payment settlement state from Operations, claim edge WAF/backup/provider health without evidence, or expose secrets in logs/reports.