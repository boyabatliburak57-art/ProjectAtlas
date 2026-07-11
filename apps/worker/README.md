# Worker

Project Atlas BullMQ worker uygulaması.

## Yerel geliştirme

Redis'i başlatın, repository kökündeki `.env.example` dosyasını `.env` olarak kopyalayın
ve worker'ı çalıştırın:

```bash
docker compose up -d redis
pnpm --filter worker dev
```

Worker açılışta Redis bağlantısını doğrular, internal heartbeat işini kuyruğa ekler ve
`SIGINT`/`SIGTERM` sırasında yeni iş almayı durdurup aktif işi tamamlayarak kapanır.

## Queue standardı

Queue adları `atlas.<domain>.v<major>` biçimindedir:

- `atlas.system.v1`
- `atlas.system.dead-letter.v1`

Job adları `<domain>.<operation>.v<major>` biçimindedir. Heartbeat işi
`system.heartbeat.v1` adını kullanır.

## İdempotent job örneği

Heartbeat producer aynı zaman aralığında deterministik `jobId` üretir:

```text
worker-heartbeat-<interval-bucket>
```

BullMQ aynı queue içinde aynı `jobId` değerini ikinci kez kabul etmediği için aynı mantıksal
heartbeat tekrar kuyruğa yazılmaz. Gerçek işlerde `jobId`, provider + instrument + timeframe +
requested range gibi doğal idempotency anahtarından türetilmelidir.

## Retry ve dead-letter

- Varsayılan 5 deneme
- Exponential backoff, 1 saniye başlangıç ve jitter
- Başarısız iş ana queue'da korunur
- Son denemeden sonra dead-letter queue'ya yalnızca güvenli metadata yazılır
- Ham payload, hata mesajı ve stack dead-letter kaydına kopyalanmaz

## Kontroller

```bash
pnpm --filter worker lint
pnpm --filter worker typecheck
pnpm --filter worker test
pnpm --filter worker build
```

Bu scaffold provider, indikatör, scanner veya alarm iş mantığı içermez.
