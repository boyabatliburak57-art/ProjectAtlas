# Production Security Test Matrix

## Authentication/session

- secure cookies/headers
- session rotation
- logout invalidation
- brute force
- reset token expiry
- disabled account

## Authorization

- all private resource IDOR
- admin RBAC
- service/job actor context
- export/download ownership
- feature flag/admin operations

## Input abuse

- oversized JSON
- pagination/date/universe limits
- CSV/file limits
- XSS
- SQL injection
- command injection
- SSRF
- path traversal
- prototype pollution
- invalid decimal/date

## Browser security

- CSP
- HSTS
- frame protection
- referrer/permissions policy
- CORS allowlist
- CSRF

## Secrets/logs

- repository scan
- image scan
- startup masking
- log redaction
- trace redaction
- error response

## Rate/abuse

- IP/user rate limit
- expensive endpoint weights
- concurrent jobs
- Retry-After
- bypass attempts

## Supply chain

- lockfile
- dependency audit
- SBOM
- container base digest
- container vulnerability scan
- license policy

## Admin

- dangerous confirmation
- audit completeness
- queue allowlist
- no arbitrary payload
- cross-environment isolation
