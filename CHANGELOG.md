# Changelog

## Unreleased

### Eklendi

- TASK-004 kapsamında Next.js App Router web uygulaması iskeleti
- Tailwind CSS ve shadcn/ui kuruluma hazır frontend yapılandırması
- TanStack Query provider, public environment doğrulaması ve Vitest temel testleri
- TASK-005 kapsamında NestJS API uygulaması iskeleti
- Liveness/readiness, OpenAPI, environment doğrulaması ve standart hata zarfı
- Structured JSON logging ile request/correlation id altyapısı
- Güvenlik advisory'si için patched PostCSS transitive dependency override'ı
- TASK-006 kapsamında BullMQ worker uygulaması iskeleti
- Sürümlü queue sözleşmeleri, heartbeat, retry ve dead-letter temeli
- Redis fail-fast bağlantısı, structured logging ve graceful shutdown
- TASK-007 kapsamında Drizzle tabanlı ilk PostgreSQL şeması ve migration'lar
- Instrument Master ve Market Data için sekiz tablo, current revision görünümü ve seed
- Migration constraint integration testleri ve ADR-004 veri erişimi kararı
- TASK-008 provider capability ve normalize instrument/bar sözleşmeleri
- Güvenli provider error taxonomy, validation wrapper, registry ve fake provider adapter

### Doğrulandı

- TASK-006 Redis bağlantısı, heartbeat tüketimi ve kontrollü worker kapanışı
- TASK-007 migration, foreign key, unique constraint ve idempotent seed senaryoları
  PostgreSQL 17 üzerinde doğrulandı

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
