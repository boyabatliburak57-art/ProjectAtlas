# TASK-004 — Web Application Scaffold

**Durum:** Hazır  
**Bağımlılık:** TASK-002

## Amaç

`apps/web` altında Next.js ve TypeScript tabanlı web uygulaması iskeletini oluşturmak.

## Kapsam

- Next.js App Router
- TypeScript strict
- Tailwind CSS
- shadcn/ui kuruluma hazır yapı
- TanStack Query provider
- temel layout
- health/demo page
- environment validation
- lint, typecheck, test
- erişilebilir temel HTML yapısı

## Kapsam dışı

- gerçek dashboard
- auth UI
- scanner UI
- piyasa verisi
- grafik ekranı

## Kabul kriterleri

- `pnpm --filter web dev` çalışır
- `pnpm --filter web build` başarılı
- typecheck başarılı
- ana sayfa minimal proje durumunu gösterir
- API URL environment üzerinden okunur
- iş mantığı eklenmez

## T3 Code prompt

```text
TASK-004 görevini uygula.
DOC-004 ve DOC-005 belgelerini önce oku.
apps/web içinde minimal Next.js App Router iskeleti oluştur.
Henüz ürün ekranları geliştirme.
Build, lint, typecheck ve temel testi çalıştır.
Eklediğin bağımlılıkları gerekçeleriyle raporla.
```
