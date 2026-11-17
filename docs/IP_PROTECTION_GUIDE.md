# IP Protection Guide

## Current controls

Kitz and MarketHub use the shared Redis-backed express-rate-limit implementation with opaque account/IP keys. Kitz trusts a configured proxy depth and MarketHub has its own proxy configuration. Production requires `REDIS_URL`; store failures reject protected requests rather than falling back to process-local counters. Operations health exposes only whether the shared limiter is configured/ready.

## Not implemented

There is no persisted IP allowlist/denylist, CIDR administration, expiring IP-block table, operator block/unblock UI, automatic blocking policy, geographic anomaly source, or trusted-infrastructure confirmation workflow. Rate limiting is not an IP reputation engine. No automated IP blocks are issued by the new WAF.

## Operations

Verify the real hosting proxy chain before changing trust-proxy settings. Never use arbitrary `X-Forwarded-For` values as client identity. Configure Redis separately for each application environment, test multi-instance atomic counters, and retain fail-closed behavior. Redis URLs and credentials must never be shown in Operations or logs.

Do not claim IP protection beyond the tested rate-limiter behavior until persistent policy storage and approval/audit workflows exist.