# NO-GO — TASK-079 Release Candidate and Operational UX

Date: 2026-07-22  
Target version: `0.9.0-rc.N`  
Environment: staging only

## Outcome

The staging release workflow and admin operational UX were extended, but no release candidate was
deployed. The repository has no staging Kubernetes context or credentials in this execution environment,
and TASK-078 remains NO-GO because its mandatory real-staging load, soak and chaos evidence is absent.
These prerequisites are fail-closed and this report does not represent them as PASS. Production was not
accessed or deployed.

## Delivered

- Manual staging releases require an explicit `0.9.0-rc.N` version; push releases derive the same
  repository-version format from the workflow run number.
- The workflow builds four immutable digest-addressed images with provenance/SBOM attestations and scans
  the API and worker images for Critical/High findings.
- Backup/PITR and recent restore-drill status is checked before deployment, including RPO, RTO and restored
  application smoke gates.
- Migration dry-run uses a dedicated isolated staging-clone database credential. The immutable release is
  rendered, migrations are applied, and all API/web/worker rollouts are checked.
- The release artifact records version, commit SHA, every image digest, SBOM/scan result, ordered migration
  list, configuration schema version, feature flags, release notes and validation summary. The same
  release is persisted through the audited admin release API.
- The synthetic runner now covers all requested journeys: login/session, market overview,
  watchlist/alert, scanner create/result, portfolio valuation, backtest create/result, experiment
  create/result and admin operations access (15 HTTP checks).
- Admin Operations now exposes queue pause/resume, release-flag percentage rollout, release status,
  incident visibility, recovery drill visibility and recent operational audit visibility. Mutations retain
  explicit confirmation and optimistic version checks.

## Local verification

| Gate                         | Result                                          |
| ---------------------------- | ----------------------------------------------- |
| Synthetic self-test          | PASS — 8 journeys / 15 HTTP checks              |
| Admin web E2E                | PASS — 3/3                                      |
| API operational policy tests | PASS — 2/2                                      |
| Web typecheck                | PASS                                            |
| API typecheck                | PASS                                            |
| Workflow lint                | PASS                                            |
| Repository format check      | PASS                                            |
| Secret scan                  | PASS — working tree and 203 commits, zero leaks |
| Diff whitespace validation   | PASS                                            |

## Acceptance status

| Criterion                              | Status                                                                                   |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Staging RC reproducible                | READY, not executed remotely                                                             |
| Full synthetic PASS                    | Local contract PASS; real staging NOT RUN                                                |
| Admin RBAC PASS                        | Prior TASK-075/077 evidence PASS; RC staging revalidation NOT RUN                        |
| Operational E2E PASS                   | Admin browser contract PASS; real staging exercises NOT RUN                              |
| Flag/kill switch PASS                  | Contract coverage present; percentage/rollback and both kill switches NOT RUN on staging |
| Rollback rehearsal PASS                | NOT RUN — previous deployed digest and staging context unavailable                       |
| Incident game-day PASS                 | Prior staging-profile game-day PASS; RC incident game-day NOT RUN                        |
| Secret exposure = 0                    | PASS                                                                                     |
| Critical alert/runbook validation PASS | Rules previously PASS; RC alert delivery test NOT RUN                                    |

## Blocking staging evidence

An authorized staging run must first close TASK-078 and then execute this workflow with the staging
Kubernetes config, operations/metrics/synthetic credentials, isolated migration database, alert-test hook,
feature-flag snapshot and a previous immutable release digest. Queue pause/resume, controlled failed-job
retry, maintenance banner, scanner/backtest kill switches, incident timeline, recovery visibility and
application/worker/flag rollback must be captured in the persisted RC validation summary.

Because mandatory evidence is missing, TASK-079 remains NO-GO. No subsequent task recommendation is made.
