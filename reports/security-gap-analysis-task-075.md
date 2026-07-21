# TASK-075 Security Gap Analysis

Date: 2026-07-21  
Scope: authentication/session, authorization, abuse controls, browser security, input handling, supply chain, DAST and operations APIs.

## Executive result before remediation

**NO-GO**. Two high-severity authorization/authentication gaps and five medium control gaps require remediation before the production security gate can pass.

## Findings

| ID          | Severity | Finding and evidence                                                                                                                                                                                                     | Required remediation                                                                                                                                     | Owner               |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| SEC-075-001 | High     | The API has an `AUTHENTICATED_USER_RESOLVER`, but no production middleware populates `request.authenticatedUserId`; no session persistence, rotation, logout revocation, disabled-account or reset-token runtime exists. | Add a durable hashed-session authority, secure cookie/bearer resolution, rotation, logout, disabled-account and reset-token controls with tests.         | Identity / API      |
| SEC-075-002 | High     | Incident admin authorization trusts the caller-controlled `x-atlas-admin-role: operations` header. A valid user could self-assert the operations role.                                                                   | Resolve roles/scopes from the authenticated server-side principal; make admin authorization deny-by-default and audit every mutation.                    | Platform Security   |
| SEC-075-003 | Medium   | Endpoint-specific guards are fragmented and mostly in-memory. There is no shared IP + user policy for normal read/write, scanner, recalculate, import/export, backtest, experiment and admin classes.                    | Add centralized weighted rate limiting, `Retry-After`, abuse metrics and endpoint classification; retain domain quotas/concurrency limits.               | API Platform        |
| SEC-075-004 | Medium   | API and web responses do not centrally enforce CSP, HSTS, MIME sniffing, referrer, permissions and frame policies.                                                                                                       | Add tested security-header middleware/configuration with an explicit CSP enforcement policy.                                                             | Web Platform        |
| SEC-075-005 | Medium   | CORS uses a configured origin but does not reject wildcard-with-credentials configuration. Cookie-authenticated mutations have no CSRF validation.                                                                       | Validate an explicit origin allowlist, prohibit credential wildcard, and enforce origin plus double-submit CSRF for cookie-authenticated unsafe methods. | Identity / Web      |
| SEC-075-006 | Medium   | DB-009 feature flags, operational audit and release records are not yet persisted or exposed behind a common admin authorization boundary.                                                                               | Add DB-009 tables, immutable audit records and operations-admin APIs; never expose raw secrets/provider payloads.                                        | Platform Operations |
| SEC-075-007 | Medium   | No repository-owned production security validator or safe staging DAST smoke currently checks headers, CORS/CSRF, malformed input and authorization.                                                                     | Add deterministic API/browser DAST smoke, artifact validation and CI integration.                                                                        | AppSec              |
| SEC-075-008 | Low      | SBOM, image scan, digest pinning, dependency audit and secret scan exist; license policy and secret rotation/malicious-package response runbooks are incomplete.                                                         | Add machine-readable license policy and operational rotation/supply-chain response documentation.                                                        | Supply Chain        |

## Existing controls retained

- Ownership/IDOR tests already cover saved scans, scanner runs, alerts, watchlists, notifications, portfolios, transactions, imports/exports, strategies, backtests and experiments.
- Scanner AST, strategy AST, pagination, date/range, experiment combination, CSV size/row and decimal validation already use bounded schema/domain validation.
- CSV import/export formula-injection protections and note/XSS handling are tested.
- Production error responses suppress stack traces.
- Central log/trace redaction and metric-cardinality guards exist from TASK-074.
- Secret scanning, dependency audit, SBOM generation, container scanning, immutable base-image digest and network default-deny controls exist from TASK-073/074.
- No production `eval`, `new Function`, user SQL, arbitrary command execution or user-controlled filesystem path was found. Child-process usage is confined to benchmark/development tooling.
- No production feature accepts an arbitrary outbound URL; the current product surface therefore has no user-controlled SSRF sink.

## Remediation acceptance

The final result may become PASS only when unresolved critical/high findings, IDOR failures, admin RBAC failures, secret leaks, rate-limit bypasses, CORS/CSRF failures and security-header failures are all zero. Any unverified remote-staging control must be reported separately from deterministic local staging-profile evidence.
