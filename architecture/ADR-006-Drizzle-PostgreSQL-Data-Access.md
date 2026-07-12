# ADR-006 — PostgreSQL Veri Erişimi için Drizzle

**Durum:** Kabul edildi  
**Tarih:** 2026-07-12

## Bağlam

Project Atlas; PostgreSQL'e özgü partial index, check constraint, `numeric`, `timestamptz`,
identity ve görünüm özelliklerini kullanacaktır. API ile worker aynı şema sözleşmesini
paylaşırken domain katmanı ORM'e bağımlı olmamalıdır.

## Karar

İlk fiziksel veri tasarımı ve migration yönetimi için Drizzle ORM ile node-postgres
kullanılacaktır. Şema `packages/database` içinde tutulacak, üretilen SQL migration'lar
repository'ye commit edilecektir.

## Gerekçe

- Üretilen SQL açıkça incelenebilir.
- PostgreSQL constraint ve partial index özellikleri doğrudan modellenebilir.
- `numeric` değerleri string olarak taşıyarak binary floating point riski azaltılır.
- API ve worker hafif bir ortak database paketi kullanabilir.
- Migration üretimi ile runtime veri erişimi aynı şemadan türetilir.

## Değerlendirilen alternatif

Prisma değerlendirilmiştir. Güçlü client üretimi sunmasına rağmen PostgreSQL'e özgü fiziksel
tasarımın SQL görünürlüğü ve migration kontrolü bu aşamada Drizzle lehine önceliklendirilmiştir.

## Sınırlar

- Domain paketleri Drizzle import etmez.
- Repository arayüzleri domain ile database implementasyonunu ayırır.
- Uygulama boundary'sinde para ve oranlar decimal string olarak taşınır.
- TimescaleDB ve partition ölçülmüş ihtiyaç olmadan eklenmez.

## Migration ve geri dönüş

Production migration'ları ileri yönlüdür. Hata halinde tercih sırası:

1. Uygulama rollout'unu durdurmak veya geri almak,
2. veri kaybetmeyen compensating migration uygulamak,
3. destructive değişiklikte doğrulanmış backup/restore prosedürünü kullanmak.

Otomatik `down` migration, veri kaybını gizleyebileceği için varsayılan yaklaşım değildir.
