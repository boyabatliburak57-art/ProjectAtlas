# Atlas Doküman İndeksi

## v0.4 zorunlu okuma

- `docs/DOC-011-Scanner-Runtime-Requirements.md`
- `docs/DOC-012-Saved-Scans-and-Presets.md`
- `docs/DOC-013-Scanner-User-Experience.md`
- `architecture/ARCH-005-Scanner-Runtime.md`
- `architecture/ADR-006-Scan-Run-As-Resource.md`
- `architecture/ADR-007-Immutable-Scan-Revisions.md`
- `database/DB-004-Scanner-Runtime-Persistence.md`
- `api/API-004-Scanner-Runtime-and-Saved-Scans.md`
- `guides/SCANNER_RUNTIME_TEST_MATRIX.md`

## Görev sırası

TASK-001–011F Foundation; TASK-012–020 Indicator/Scanner Core; TASK-021 core audit; TASK-022 migrations; TASK-023 run service; TASK-024 worker; TASK-025 API; TASK-026 saved scans; TASK-027 presets; TASK-028 progress; TASK-029 web; TASK-030 milestone audit.

## Geçiş kapıları

- Foundation re-audit GO olmadan TASK-012 uygulanmaz.
- TASK-021 GO olmadan TASK-022 uygulanmaz.
- TASK-030 GO olmadan sonraki paket uygulanmaz.

## Öncelik

Project Constitution > Accepted ADR > Security/Quality > Software/Engine/Runtime requirements > Architecture/DB/API > Product/UX > Task card > code comments.

## v0.4.1 Indicator/Scanner Core Remediation Gate

1. `tasks/TASK-021A-ADR-006-Collision-Remediation.md`
2. `tasks/TASK-021B-Markdown-Formatting-Remediation.md`
3. `tasks/TASK-021C-Indicator-Scanner-Core-Reaudit.md`

Referanslar:

- `reports/REMEDIATION_PLAN-v0.4.1.md`
- `docs/DOC-014-Documentation-Identifier-and-Formatting-Policy.md`

TASK-021C sonucu GO olmadan TASK-022 uygulanmaz.

## v0.4.2 Scanner Runtime Remediation Gate

1. `tasks/TASK-030A-Scanner-Formatting-Remediation.md`
2. `tasks/TASK-030B-Scanner-Performance-Baseline.md`
3. `tasks/TASK-030C-Custom-Scan-AST-Roundtrip-E2E.md`
4. `tasks/TASK-030D-Scanner-Runtime-Reaudit.md`

Referanslar:

- `reports/REMEDIATION_PLAN-v0.4.2.md`
- `docs/DOC-015-Scanner-Performance-and-E2E-Quality-Gates.md`
- `guides/SCANNER_PERFORMANCE_BASELINE_GUIDE.md`

TASK-030D sonucu GO olmadan sonraki pakete geçilmez.
