# Yerel Geliştirme Ortamı

Bu ortam yalnızca yerel geliştirme içindir. PostgreSQL ve Redis host üzerinde yalnızca
`127.0.0.1` adresine açılır.

## Gereksinimler

- Node.js `22.14.0`
- Corepack ile pnpm `9.15.4`
- Docker Engine veya Docker Desktop
- Docker Compose

Repository `.nvmrc`, `.node-version`, `package.json#engines` ve `packageManager` alanlarında aynı
Node/pnpm hedefini kullanır. Kurulumdan önce:

```bash
nvm use
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm version:check
```

Yanlış Node sürümünde version check ve `pnpm install` başarısız olur.

## İlk kurulum

Örnek ortam dosyasını kopyalayın ve `POSTGRES_PASSWORD` ile `DATABASE_URL` içindeki
örnek parolayı yalnızca kendi yerel ortamınız için değiştirin:

```bash
cp .env.example .env
docker compose up -d
docker compose ps
```

`.env` Git tarafından yok sayılır ve repoya eklenmemelidir.

## Bağlantılar

PostgreSQL:

```text
postgresql://atlas:<local-password>@127.0.0.1:5432/atlas
```

Redis:

```text
redis://127.0.0.1:6379
```

Portlar `.env` içindeki `POSTGRES_PORT` ve `REDIS_PORT` değerleriyle değiştirilebilir.

## Market-data worker

Market-data işleri `atlas.market-data.v1` kuyruğunda çalışır. Worker başlangıcında
instrument import ve OHLCV ingestion processor'ları PostgreSQL repository'leriyle
compose edilir. Bu aşamada yalnızca boş fixture'lara sahip `fake-provider` adapter'ı
kayıtlıdır; ticari provider ve cron schedule bulunmaz.

Producer'lar job isimlerini ve deterministik idempotency job ID'lerini
`apps/worker/src/queue` altındaki merkezi sözleşmelerden kullanmalıdır. Provider
rate-limit, timeout ve unavailable hataları retry edilir; doğrulama, unsupported
timeframe, mapping/authentication ve bilinmeyen job hataları retry edilmez.

## Sağlık kontrolü

```bash
docker compose ps
docker compose exec postgres pg_isready -U atlas -d atlas
docker compose exec redis redis-cli ping
```

## Servisleri durdurma

```bash
docker compose down
```

Bu komut named volume'leri silmez. Verileri bilinçli olarak silmek gerektiğinde ayrıca
`docker compose down --volumes` kullanılmalıdır.
