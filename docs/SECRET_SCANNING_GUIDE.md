# Secret Scanning Guide

The Operations `secrets` scan scope performs a local, bounded walk of the repository. It skips ignored/generated directories, symlinks, binary files, and files over 512 KB; limits traversal to 20,000 files; and checks high-confidence named assignments, selected known-token formats, and private-key markers. It does not upload content to a third party.

Findings include only rule ID, relative path, line number, a location-only fingerprint, severity, and remediation guidance. Secret values and secret-derived hashes are not included. Results use the existing security scan persistence/lifecycle and require the `security.scan` capability. Example placeholders are suppressed.

This scanner is not an entropy scanner, deployment-environment scanner, Git-history scanner, cloud secret-manager auditor, or guarantee that all secrets are detected. Do not paste a suspected value into Operations. Confirm locally and rotate through the owning provider if valid. This feature has local tests but no production repository/secret-manager verification.

## Current local scan evidence

On 2026-11-16 the bounded scanner walked 422 files, skipped 25, and returned 48 masked candidates. Six locations were in the root `.env` and eight in `platform/.env`; both files are Git-ignored. Other candidates include tests and source assignments. The findings were not individually verified and their matched values were not read or printed. Do not treat this scan as clean; an authorized owner must review those locations in the secret store/repository and rotate any confirmed credential.