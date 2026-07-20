# Changelog

## 0.8.1-strategy-lab-remediation — 2026-07-19

### Eklendi

- DOC-035 Backtest Metrics and Benchmark Quality Gates
- Backtest Benchmark Runner Specification
- Strategy Lab E2E Stability Guide
- Strategy Lab v0.8.1 remediation planı
- TASK-070A Backtest Metrics Remediation
- TASK-070B Experiment Production Worker Wiring
- TASK-070C Backtest Performance Benchmark Runner
- TASK-070D Strategy Lab E2E Stability
- TASK-070E Strategy Lab Milestone Re-Audit

### Değişti

- TASK-070 NO-GO bulguları ve zorunlu TASK-070A → TASK-070E uygulama sırası README ve ATLAS_INDEX'e eklendi.
- Mandatory metrics, gerçek turnover, production experiment worker, PERF-BT-001–006 ve full Playwright stability yeniden GO kapısına bağlandı.

### Değişmedi

- Yeni ADR oluşturulmadı; mevcut ADR dosyaları ve kimlikleri değiştirilmedi.
- Mevcut benchmark threshold'ları ve fixture kapsamları değiştirilmedi.
- Playwright testlerine skip, fixme veya only eklenmedi.

## 0.8.0-strategy-lab — 2026-07-18

### Eklendi

- DOC-030–DOC-034 backtesting, strategy versioning, execution/cost/data integrity, research experiments ve Strategy Lab UX gereksinimleri
- ARCH-013–ARCH-015 deterministic backtest engine, worker/results ve research experiment runtime mimarileri
- Backtesting Policies karar önerisi
- DB-008 Strategies, Backtests and Experiments persistence tasarımı
- API-008 Strategies, Backtests and Experiments API sözleşmesi
- Backtest Data Integrity Guide, Test Matrix ve Performance Baseline rehberleri
- TASK-061–TASK-070 geliştirme, baseline ve milestone audit görevleri

### Değişti

- v0.8 Strategy Lab belge kapsamı ve TASK-061 → TASK-070 sırası README ve ATLAS_INDEX'e eklendi.
- TASK-070 GO sonucu sonraki paket için zorunlu geçiş kapısı olarak kaydedildi.

### Değişmedi

- Mevcut ADR dosyaları ve kimlikleri değiştirilmedi veya yeniden numaralandırılmadı.
- TASK-062 için sabit ADR numarası üretilmedi; sonraki boş ve benzersiz kimliklerin repository taramasıyla seçilmesi korundu.
- Önceki milestone performance threshold'ları ve baseline sonuçları değiştirilmedi.

## 0.7.0-market-intelligence — 2026-07-18

### Eklendi

- DOC-025–DOC-029 Market Intelligence, Symbol Detail, Fundamentals, Pattern Detection ve UX gereksinimleri
- ARCH-010–ARCH-012 read model, chart/overlay ve pattern runtime mimarileri
- Market Intelligence policy karar önerisi
- DB-007 Market Intelligence, Fundamentals ve Pattern persistence tasarımı
- API-007 Market Intelligence ve Symbol Detail API sözleşmesi
- Chart Data Contract, Market Intelligence Performance Baseline ve Test Matrix rehberleri
- TASK-051–TASK-060 geliştirme ve milestone audit görevleri

### Değişti

- v0.7 Market Intelligence belge kapsamı ve TASK-051 → TASK-060 sırası README ve ATLAS_INDEX'e eklendi.
- TASK-060 GO sonucu sonraki paket için zorunlu geçiş kapısı olarak kaydedildi.

### Değişmedi

- Mevcut ADR dosyaları ve kimlikleri değiştirilmedi veya yeniden numaralandırılmadı.
- TASK-052 için sabit ADR numarası üretilmedi; sonraki boş ve benzersiz kimliklerin repository taramasıyla seçilmesi korundu.

## 0.6.1-portfolio-risk-remediation — 2026-07-16

### Eklendi

- DOC-024 Pagination and Regression Performance Gates
- Positions Cursor Pagination Contract
- Watchlist Market Summary Performance Guide
- Portfolio/Risk remediation plan
- TASK-050A Positions Cursor Pagination Remediation
- TASK-050B Watchlist Market Summary Performance Remediation
- TASK-050C Portfolio/Risk Milestone Re-Audit

### Değişti

- TASK-050 NO-GO bulguları ve zorunlu TASK-050A → TASK-050B → TASK-050C geçiş sırası README ve ATLAS_INDEX içine eklendi.
- Mevcut performans eşikleri korunarak gerçek application/API pagination yolu ve watchlist market summary regresyon kapıları belgelendi.

### Değişmedi

- Mevcut performans eşikleri değiştirilmedi.
- Yeni ADR oluşturulmadı ve mevcut ADR kimlikleri değiştirilmedi.

## 0.5.0-alerts-watchlists — 2026-07-14

### Eklendi

- DOC-016–DOC-018
- ARCH-006–ARCH-007
- DB-005
- API-005
- Alert/Notification Test Matrix
- TASK-031–TASK-040

### Değişti

- v0.5 belgeleri README ve ATLAS_INDEX içine mevcut remediation kapıları korunarak eklendi.
- Mevcut ADR-008 kararı, ADR-006 ve ADR-007 numaraları değiştirilmeden resmi ADR indeksine eklendi.

## 0.4.2-scanner-runtime-remediation — 2026-07-14

### Eklendi

- Scanner Runtime remediation plan
- DOC-015 Scanner Performance and E2E Quality Gates
- Scanner Performance Baseline Guide
- TASK-030A Scanner Formatting Remediation
- TASK-030B Scanner Performance Baseline
- TASK-030C Custom Scan AST Round-Trip E2E
- TASK-030D Scanner Runtime Re-Audit

### Değişti

- Scanner Runtime milestone sonrası zorunlu remediation geçiş kapısı eklendi.
- README ve ATLAS_INDEX güncellendi.

## 0.4.1-runtime-remediation — 2026-07-11

### Eklendi

- Indicator/Scanner Core remediation plan
- DOC-014 Documentation Identifier and Formatting Policy
- TASK-021A ADR-006 Collision Remediation
- TASK-021B Markdown Formatting Remediation
- TASK-021C Indicator/Scanner Core Re-Audit

### Değişti

- TASK-022 öncesine zorunlu repository gate remediation eklendi.

## 0.4.0-scanner-runtime — 2026-07-11

### Eklendi

- DOC-011, DOC-012, DOC-013
- ARCH-005, ADR-006, ADR-007
- DB-004, API-004
- Scanner Runtime Test Matrix
- TASK-021–TASK-030

## 0.3.1-foundation-remediation — 2026-07-11

### Eklendi

- Foundation remediation plan
- DOC-010 Quality Gates and Toolchain Policy
- ADR index
- TASK-011A Formatting Baseline
- TASK-011B ADR Identifier Remediation
- TASK-011C Secret Scanning and CI
- TASK-011D Node Version Enforcement
- TASK-011E Market Data Worker Wiring
- TASK-011F Foundation Re-Audit

### Değişti

- TASK-012 öncesine zorunlu remediation geçiş kapısı eklendi.
- README ve ATLAS_INDEX güncellendi.

## 0.3.0-indicator-scanner-core — 2026-07-11

### Eklendi

- DOC-008 Indicator Engine Requirements
- DOC-009 Scanner Engine Requirements
- ARCH-003 Indicator Engine
- ARCH-004 Scanner Engine
- ADR-004 Indicator Versioning and Fixtures
- ADR-005 Three-State Scan Evaluation
- DB-003 Indicator and Scanner Schema
- API-003 Indicators and Scanner
- Indicator Fixture Guide
- TASK-011–TASK-020

## 0.2.0-engineering-baseline — 2026-07-11

### Eklendi

- DOC-004 Technology Stack
- DOC-005 Repository and Code Standards
- DOC-006 Security and Privacy Requirements
- DOC-007 Development and Release Workflow
- ADR-001 Modular Monolith
- ADR-002 TypeScript and NestJS Backend
- ADR-003 Versioned Scan Rule AST
- ARCH-002 Market Data Engine
- DB-002 Market Data Physical Design
- API-002 Instruments and Market Data API
- T3 Code execution checklist
- TASK-004–TASK-010
- Pull request template

### Değişti

- Doküman indeksi v0.2 kapsamına göre güncellendi.
- README sürüm ve aşama bilgisi güncellendi.

## 0.1.0-foundation — 2026-07-11

### Eklendi

- Proje anayasası
- BRD, PRD ve SRS
- Sistem genel mimarisi
- Kavramsal veri modeli
- API genel ilkeleri
- T3 Code başlangıç ve sistem talimatı
- İlk üç görev kartı
- GitHub ve T3 Code entegrasyon rehberleri

Bu sürüm uygulama kodu içermez.
