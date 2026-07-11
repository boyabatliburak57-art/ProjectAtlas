# TASK-007 — Initial Database Schema

**Durum:** Tamamlandı
**Bağımlılık:** TASK-005

## Amaç

Instrument Master ve Market Data için ilk migration'ları oluşturmak.

## Referanslar

- DB-001
- DB-002
- DOC-003
- DOC-006

## Kapsam

- sectors
- instruments
- instrument_symbol_history
- data_providers
- provider_instrument_mappings
- price_bars
- data_quality_issues
- ingestion_runs

## Gereksinimler

- PostgreSQL
- UUID stratejisi
- timestamptz
- numeric fiyat/hacim
- foreign key
- unique constraint
- audit timestamp
- idempotent seed
- test migration

## Kapsam dışı

- user/auth tabloları
- scanner tabloları
- portfolio tabloları
- Timescale extension
- partition

## Kabul kriterleri

- temiz veritabanında migration başarılı
- şema testleri geçer
- duplicate bar constraint testi var
- invalid foreign key engellenir
- seed tekrar çalıştırılabilir
- rollback veya geri dönüş yaklaşımı belgelenir

## T3 Code prompt

```text
TASK-007 görevini uygula.
DB-001 ve DB-002 belgelerini okuyup seçili ORM yaklaşımıyla migration oluştur.
Sadece belirtilen tabloları ekle.
TimescaleDB ve partition ekleme.
Migration ve constraint integration testlerini çalıştır.
```

## Tamamlanma notu

- **Tarih:** 2026-07-12
- **Durum:** Tamamlandı
- **Değişiklik:** Drizzle database paketi, sekiz tablo, current revision görünümü, migration,
  idempotent seed ve PostgreSQL integration testleri eklendi.
- **Migration:** İki forward migration; sekiz tablo ve `current_price_bars` görünümü.
- **Geri dönüş:** Compensating migration veya doğrulanmış backup/restore.
- **Doğrulama:** PostgreSQL 17.10 üzerinde temiz şema migration'ı, tekrar migration,
  foreign key ve duplicate bar kısıtları ile idempotent seed integration testleri geçti.
- **Bilinen sınırlama:** Yok.
- **Sonraki görev:** TASK-008
