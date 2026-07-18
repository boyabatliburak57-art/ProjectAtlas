# Architecture Decision Record Index

Bu dosya Project Atlas mimari karar kayıtlarının resmi indeksidir.

## Kurallar

- Her ADR benzersiz bir sayısal kimlik taşır.
- Kimlik tekrar kullanılamaz.
- Kabul edilmiş ADR silinmez; gerekirse `Superseded` durumuna alınır.
- Dosya adı, belge başlığı ve indeks kimliği aynı olmalıdır.
- Yeni ADR eklenmeden önce bu indeks güncellenir.
- CI duplicate ADR kimliklerini doğrular.

## Mevcut kayıtlar

| Kimlik  | Başlık                            | Durum    |
| ------- | --------------------------------- | -------- |
| ADR-001 | Modular Monolith ile Başlama      | Accepted |
| ADR-002 | Backend için TypeScript ve NestJS | Accepted |
| ADR-003 | Tarama Kuralları için Sürümlü AST | Accepted |
| ADR-004 | Indicator Versioning and Fixtures | Accepted |
| ADR-005 | Three-State Scan Evaluation       | Accepted |

## Çakışma düzeltme notu

Repository'de bu indeks dışındaki başka bir kabul edilmiş belge `ADR-004` kimliğini taşıyorsa:

1. Belgelerin oluşturulma sırası ve referansları incelenir.
2. Daha sonra oluşturulan veya index dışı kalan belge bir sonraki boş kimliğe taşınır.
3. Dosya adı, başlık ve tüm referanslar atomik olarak güncellenir.
4. İçerik değiştirilmez.
5. Değişiklik `CHANGELOG.md` içinde kaydedilir.

| ADR-006 | Scan Run as Resource | Accepted |
| ADR-007 | Immutable Scan Revisions | Accepted |
| ADR-008 | PostgreSQL Veri Erişimi için Drizzle | Accepted |
| ADR-009 | Moving Weighted Average Cost ve Immutable Portfolio Ledger | Accepted |
| ADR-010 | Portfolio Performansında TWR ve XIRR Ayrımı | Accepted |
| ADR-011 | Historical VaR ve Sürümlü Risk Metodolojisi | Accepted |
| ADR-012 | Market Overview için Sürümlü Snapshot Read Model | Accepted |
| ADR-013 | Chart Adjustment Mode ve Data Cutoff Politikası | Accepted |
| ADR-014 | Fundamentals Restatement Revision ve Ratio Formula Versioning | Accepted |
| ADR-015 | Pattern Candidate Semantiği ve No-Look-Ahead Kuralı | Accepted |
| ADR-016 | Closed-Bar Signal ve Next-Open Varsayılan Execution | Accepted |
| ADR-017 | Point-in-Time Data ve Survivorship-Bias Politikası | Accepted |
| ADR-018 | Deterministik Event Ordering ve Reproducibility | Accepted |
| ADR-019 | Varsayılan Commission ve Slippage Modeli | Accepted |
| ADR-020 | Bounded Grid Experiments ve Holdout Politikası | Accepted |
