# TASK-075 — Security Hardening and Abuse Prevention

**Bağımlılık:** TASK-073, TASK-074

## Kapsam

- auth/session review
- authorization/IDOR expansion
- admin RBAC
- rate/cost limits
- request/file limits
- CORS/CSRF
- CSP/HSTS/security headers
- input/output hardening
- SSRF/path traversal/prototype pollution tests
- secret/log/trace redaction
- SBOM/container scan
- DAST staging smoke
- dependency/license policy
- security audit reporting

## Kabul

- critical/high unresolved = 0 veya approved exception
- IDOR = 0
- rate bypass = 0
- CSRF/CORS/header pass
- secret leakage = 0
- admin authorization pass
- security report generated
