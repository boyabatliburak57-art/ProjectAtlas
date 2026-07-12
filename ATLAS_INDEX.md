# Atlas Doküman İndeksi

## Temel belgeler

1. `README.md`
2. `T3_CODE_START_HERE.md`
3. `SYSTEM_PROMPT.md`
4. `docs/DOC-000-Project-Constitution.md`
5. `docs/DOC-001-Business-Requirements.md`
6. `docs/DOC-002-Product-Requirements.md`
7. `docs/DOC-003-Software-Requirements.md`
8. `docs/DOC-004-Technology-Stack.md`
9. `docs/DOC-005-Repository-and-Code-Standards.md`
10. `docs/DOC-006-Security-and-Privacy-Requirements.md`
11. `docs/DOC-007-Development-and-Release-Workflow.md`
12. `docs/DOC-008-Indicator-Engine-Requirements.md`
13. `docs/DOC-009-Scanner-Engine-Requirements.md`

## Mimari

- ARCH-001 System Overview
- ARCH-002 Market Data Engine
- ARCH-003 Indicator Engine
- ARCH-004 Scanner Engine
- ADR-001–ADR-006

## Veri ve API

- DB-001 Conceptual Model
- DB-002 Market Data Physical Design
- DB-003 Indicator and Scanner Schema
- API-001 Overview
- API-002 Instruments and Market Data
- API-003 Indicators and Scanner

## Görev sırası

- TASK-001–TASK-010: Foundation ve Market Data
- TASK-011: Foundation Milestone Audit
- TASK-012–TASK-017: Indicator Engine
- TASK-018–TASK-020: Scanner AST, evaluator ve planner

## Geçiş kapısı

TASK-011 kritik failure içeriyorsa TASK-012'ye geçilmez. TASK-020 sonunda tam scan run execution henüz yoktur; sonraki paket queue execution, persistence, hazır taramalar ve scanner UI akışını ekleyecektir.

## Öncelik

1. Project Constitution
2. Kabul edilmiş ADR
3. Security Requirements
4. Software Requirements
5. Engine Requirements
6. Architecture/Database/API
7. Product Requirements
8. Business Requirements
9. Task Card
10. Kod içi yorum

## v0.3.1 Remediation Geçiş Kapısı

TASK-011 audit sonucu NO-GO ise aşağıdaki görevler sırasıyla uygulanır:

1. `tasks/TASK-011A-Formatting-Baseline.md`
2. `tasks/TASK-011B-ADR-Identifier-Remediation.md`
3. `tasks/TASK-011C-Secret-Scanning-and-CI.md`
4. `tasks/TASK-011D-Node-Version-Enforcement.md`
5. `tasks/TASK-011E-Market-Data-Worker-Wiring.md`
6. `tasks/TASK-011F-Foundation-Reaudit.md`

Referanslar:

- `reports/REMEDIATION_PLAN-v0.3.1.md`
- `docs/DOC-010-Quality-Gates-and-Toolchain-Policy.md`
- `architecture/ADR_INDEX.md`

TASK-011F sonucu GO olmadan TASK-012 uygulanmaz.
