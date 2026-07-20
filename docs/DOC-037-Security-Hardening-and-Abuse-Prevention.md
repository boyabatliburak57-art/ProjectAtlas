# DOC-037 — Security Hardening and Abuse Prevention

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Project Atlas'ın internet erişimli kullanımında hesap, API, veri, dosya, worker ve operasyon yüzeylerini sertleştirir.

## 2. Authentication ve session

Mevcut kimlik doğrulama korunur ve aşağıdakiler doğrulanır:

- secure cookie veya güvenli bearer policy,
- HttpOnly/Secure/SameSite,
- session rotation,
- logout invalidation,
- brute-force protection,
- password reset token lifetime,
- MFA-ready interface, uygulanmışsa,
- account disable/revoke.

## 3. Authorization

- deny-by-default,
- resource ownership,
- admin role separation,
- service-to-service scope,
- background job actor context,
- export/download ownership,
- feature flag targeting authorization.

IDOR test matrisi bütün özel kaynakları kapsar.

## 4. API abuse prevention

- IP ve user rate limit,
- endpoint-specific cost weight,
- expensive job quota,
- concurrent run limit,
- request body limit,
- pagination limit,
- date range/universe/combination limit,
- retry-after response,
- abuse metrics.

Scanner, backtest, experiment, export ve import ayrı maliyet sınıfları taşır.

## 5. Input ve output

- schema validation,
- allowlist enums,
- decimal/date limits,
- file type/size/row limits,
- CSV formula injection,
- XSS,
- path traversal,
- SSRF,
- prototype pollution,
- unsafe deserialization,
- command injection,
- SQL injection.

Serbest eval, dynamic code ve kullanıcı SQL'i yasaktır.

## 6. Web security headers

En az:

- Content-Security-Policy,
- Strict-Transport-Security,
- X-Content-Type-Options,
- Referrer-Policy,
- Permissions-Policy,
- frame-ancestors veya X-Frame-Options.

CSP report-only aşaması ve enforcement planı belgelenir.

## 7. CSRF ve CORS

- Cookie auth kullanılıyorsa CSRF koruması,
- CORS explicit allowlist,
- credential wildcard yasağı,
- preflight policy,
- origin validation.

## 8. Secrets

- repository'de secret yok,
- secret manager veya güvenli environment injection,
- rotation runbook,
- minimum scope,
- startup masking,
- log redaction,
- incident revocation.

## 9. Dependency ve supply chain

- lockfile,
- dependency audit,
- SBOM,
- provenance/attestation, destekleniyorsa,
- container base image pinning,
- image vulnerability scan,
- license policy,
- malicious package response plan.

## 10. Data protection

- TLS in transit,
- encryption at rest, platform seviyesinde,
- backup encryption,
- PII minimization,
- retention,
- deletion workflow,
- export audit,
- admin access audit.

## 11. Operational security

Admin/ops endpointleri:

- public kullanıcıdan ayrıdır,
- ayrı role/scope,
- audit log,
- dangerous action confirmation,
- rate limit,
- no raw secret/provider payload.

## 12. Security testing

Zorunlu:

- SAST,
- dependency scan,
- secret scan,
- container scan,
- API authorization tests,
- DAST staging smoke,
- file/upload abuse,
- rate-limit tests,
- security header tests,
- log redaction tests.

## 13. Kabul kriterleri

- Kritik/yüksek açık yoktur veya onaylı exception taşır.
- IDOR failure = 0.
- Secret log leakage = 0.
- Rate limit bypass = 0.
- CORS/CSRF/security headers testleri geçer.
- Admin işlemleri auditlidir.
