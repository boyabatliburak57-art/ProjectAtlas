# Database

Project Atlas PostgreSQL şeması, Drizzle migration'ları ve başlangıç seed'i.

## Migration stratejisi

Migration'lar production yönünde forward-only uygulanır. `0002_scanner_runtime` için eşlenmiş
rollback dosyası `drizzle/rollback/0002_scanner_runtime.down.sql` altındadır. Bu dosya veri
kaybettiren, yalnız kontrollü recovery için kullanılan manuel bir down migration'dır:

1. Scanner Runtime tablolarının yedeğini al.
2. Uygulama ve worker yazımlarını durdur.
3. Down SQL'i transaction içinde çalıştır.
4. Yalnız eşleşen `0002_scanner_runtime` migration journal kaydını kaldır.
5. Forward migration'ı yeniden uygula ve constraint/integration testlerini çalıştır.

Normal rollback, ileri yönlü düzeltme migration'ı ile yapılır; production'da journal geçmişi
yeniden yazılmaz.

## Komutlar

```bash
pnpm --filter @atlas/database db:generate
pnpm --filter @atlas/database db:migrate
pnpm --filter @atlas/database db:seed
pnpm --filter @atlas/database test
```

Integration testi yalnızca adı `_test` ile biten izole bir PostgreSQL veritabanında çalışır:

```bash
TEST_DATABASE_URL=postgresql://atlas:<local-password>@127.0.0.1:5432/atlas_test \
  pnpm --filter @atlas/database test:integration
```

Test public şemayı silip yeniden oluşturduğu için development veya production veritabanı URL'si
kabul edilmez.

## Seed

Seed, `manual-import` kodlu inactive provider kaydına ek olarak DOC-012'deki sekiz preset
kategorisini ve on published preset'in versioned AST revision'ını oluşturur. Preset AST'leri
transaction başlamadan önce domain validator, indicator registry ve execution planner ile
doğrulanır. Sabit kimlikler, upsert ve revision conflict-do-nothing politikası sayesinde seed
tekrar çalıştırılabilir ve duplicate kayıt üretmez.

## Geri dönüş

Migration'lar forward-only uygulanır. Geri dönüş için uygulama rollback'i, veri kaybetmeyen
compensating migration ve gerektiğinde doğrulanmış backup restore sırası izlenir. TimescaleDB,
partition ve destructive migration bu başlangıç paketinde yoktur.
