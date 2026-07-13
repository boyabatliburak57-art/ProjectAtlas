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
- `atlas.market-data.v1`
- `atlas.scanner.v1`

Job adları `<domain>.<operation>.v<major>` biçimindedir. Heartbeat işi
`system.heartbeat.v1` adını kullanır.

Instrument senkronizasyon handler'ı `market-data.instrument-sync.v1` iş adını kullanır. Queue
payload yalnızca provider code ve dry-run bayrağı taşır; provider response veya secret taşımaz.

OHLCV ingestion handler'ı `market-data.bar-ingestion.v1` iş adını kullanır. Payload provider
code/symbol, timeframe, ISO tarih aralığı ve opsiyonel limit taşır.

## İdempotent job örneği

Heartbeat producer aynı zaman aralığında deterministik `jobId` üretir:

```text
worker-heartbeat-<interval-bucket>
```

BullMQ aynı queue içinde aynı `jobId` değerini ikinci kez kabul etmediği için aynı mantıksal
heartbeat tekrar kuyruğa yazılmaz. Gerçek işlerde `jobId`, provider + instrument + timeframe +
requested range gibi doğal idempotency anahtarından türetilmelidir.

Scanner run işleri `scanner.run.v1` adıyla ve run ID'den türetilen deterministik job ID ile
çalışır. Worker immutable execution plan ve universe snapshot'ını PostgreSQL'den yükler;
evreni `SCANNER_BATCH_SIZE` değerine göre böler, market data/indicator/evaluator hattını
çalıştırır ve matched/notEvaluable sonuçları idempotent upsert eder. PostgreSQL kalıcı run,
batch, result ve progress doğruluk kaynağıdır; BullMQ progress hızlı bildirim katmanıdır.

Scanner timeout ayarları `SCANNER_BATCH_TIMEOUT_MS` ve `SCANNER_RUN_TIMEOUT_MS` ile
sınırlandırılır. Cancellation batch sınırlarında cooperative kontrol edilir. Gerçek piyasa
veri sağlayıcısı scanner composition root'una bağlanmamıştır; runtime kalıcı ve test fixture
verisini provider adapter ayrıntısı olmadan okur.

## Retry ve dead-letter

- Varsayılan 5 deneme
- Exponential backoff, 1 saniye başlangıç ve jitter
- Başarısız iş ana queue'da korunur
- Son denemeden sonra dead-letter queue'ya yalnızca güvenli metadata yazılır
- Ham payload, hata mesajı ve stack dead-letter kaydına kopyalanmaz

## Market data provider sınırı

`src/market-data/providers` dış sağlayıcıları worker/domain akışından ayırır:

- adapter çıktıları güvenilmeyen `unknown` veri olarak kabul edilir,
- capability, instrument ve bar yanıtları Zod ile normalize edilip doğrulanır,
- provider code registry üzerinden adapter'a çevrilir,
- retry edilebilir ve edilemez hatalar güvenli provider error kodlarına dönüştürülür,
- provider symbol yalnızca adapter/mapping sınırında kalır; internal instrument kimliği yerine
  geçmez.

Fake adapter yalnızca test ve sonraki ingest görevlerinin deterministik doğrulaması içindir.

## BIST instrument import

Instrument import pipeline:

- canonical BIST sembolünü normalize eder ve geçersiz karakteri reddeder,
- duplicate provider symbol ve duplicate ISIN kayıtlarını raporlar,
- instrument'ı mapping, ISIN veya aktif normalized symbol üzerinden eşleştirir,
- instrument ve provider mapping değişikliklerini transaction içinde uygular,
- sembol değişikliğinde eski sembolü history tablosuna yazar,
- provider listesinden eksilen aktif mapping'leri yalnızca deactivation adayı olarak raporlar,
- dry-run sırasında ingestion run dahil hiçbir veritabanı kaydı oluşturmaz,
- gerçek koşuları `ingestion_runs` tablosunda completed/failed durumuyla izler.

## OHLCV ingestion

Bar ingestion pipeline:

- normalize provider barlarını request range, timeframe, symbol mapping, future timestamp,
  OHLC ve volume kurallarıyla yeniden doğrular,
- geçersiz barı `data_quality_issues` kaydına çevirir ve `price_bars` tablosuna yazmaz,
- yeni barı revision 1 olarak ekler,
- açık barı aynı revision üzerinde güncelleyip kapatabilir,
- kapalı bar değişikliğini yeni `corrected` revision olarak ekler,
- kapalı barın yeniden açılmasını reddeder,
- aynı kalıcı içeriği duplicate metriğiyle atlar,
- doğal bar anahtarını PostgreSQL transaction advisory lock ile eşzamanlı ingest yarışından
  korur.

## Kontroller

```bash
pnpm --filter worker lint
pnpm --filter worker typecheck
pnpm --filter worker test
TEST_DATABASE_URL=postgresql://atlas:password@127.0.0.1:5432/atlas_test \
  pnpm --filter worker test:integration
pnpm --filter worker build
```

Gerçek provider entegrasyonu ve alarm iş mantığı bu kapsamda yer almaz.
