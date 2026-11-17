# Dependency Security Guide

Kitz's existing scanner discovers all checked-in npm lockfile projects, runs `npm audit`, persists scan/module/findings through the existing Operations scan tables, supports lifecycle review, cancellation, timeouts, recovery, and opt-in distributed scheduling with a database advisory lock. Local audits in this work reported zero vulnerabilities for Kitz and MarketHub at the time run; those are point-in-time registry results.

Phase 5 additions include a local repository secret-scan scope and CycloneDX output. OSV scanning, lockfile tamper verification, accepted-risk history beyond current finding lifecycle, critical-finding notifications, and additional package ecosystems are not implemented. Do not silently update dependencies to clear results. Review advisory, dependency path, available fix, compatibility, and security impact before remediation.

Production scheduled scans require the Operations database, migration baseline, worker heartbeat, and distributed coordination. A green local scan does not prove deployment dependencies or production image contents.