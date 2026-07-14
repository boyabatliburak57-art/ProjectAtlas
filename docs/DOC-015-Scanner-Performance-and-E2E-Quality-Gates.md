# DOC-015 — Scanner Performance and E2E Quality Gates

**Sürüm:** 1.0  
**Durum:** Onay için hazır

## 1. Amaç

Scanner Runtime'ın ölçülebilir performans ve gerçek kullanıcı veri akışı bakımından doğrulanmasını sağlar.

## 2. Her benchmark raporunda bulunacak bilgiler

- commit SHA
- Node ve pnpm sürümü
- işletim sistemi
- CPU ve bellek
- PostgreSQL ve Redis sürümü
- worker concurrency
- batch size
- fixture enstrüman/bar sayısı
- indicator ve AST node sayısı
- warm/cold cache
- tekrar sayısı
- p50, p95, maksimum
- hata oranı

## 3. Zorunlu senaryolar ve başlangıç eşikleri

### PERF-SCN-001 — Küçük senkron tarama

- 25 enstrüman
- 1 timeframe
- en fazla 2 unique indicator
- en fazla 5 AST node

Eşik:

- warm p95 ≤ 750 ms
- cold p95 ≤ 2000 ms
- error rate = 0

### PERF-SCN-002 — Tam BIST fixture taraması

- 500–650 enstrüman
- günlük timeframe
- 3 unique indicator
- 7–12 AST node
- gerçek worker, PostgreSQL ve Redis test yolu

Eşik:

- queue-to-terminal p95 ≤ 8 saniye
- error rate = 0
- duplicate result = 0
- progress monotonicity = 100%

### PERF-SCN-003 — Orta karmaşıklık

- 500–650 enstrüman
- 2 timeframe
- 6 unique indicator
- nested group
- cross operator
- notEvaluable senaryoları

Eşik:

- queue-to-terminal p95 ≤ 15 saniye
- worker crash = 0
- deterministic matched count
- kontrolsüz memory artışı yok

### PERF-SCN-004 — Result pagination

- en az 500 sonuç
- 50 kayıt sayfa

Eşik:

- p95 ≤ 300 ms
- duplicate/missing row = 0

### PERF-SCN-005 — Progress polling

Eşik:

- p95 ≤ 250 ms
- unauthorized access = 0
- terminal state sonrası değişim yok

### PERF-SCN-006 — Idempotent replay

Eşik:

- yeni run oluşmaz
- response p95 ≤ 300 ms
- request hash eşleşir

## 4. Threshold yönetimi

Threshold değişikliği:

- önceki ve yeni ölçüm,
- fixture/donanım farkı,
- teknik gerekçe,
- review

gerektirir. Başarısız testi geçirmek için task içinde keyfi yükseltilemez.

## 5. Benchmark izolasyonu

- Fixture deterministik olmalıdır.
- Dış internet veya gerçek provider kullanılmaz.
- DB ve Redis başlangıç durumu kontrollüdür.
- Warm/cold cache ayrılır.
- Sonuç JSON ve Markdown olarak kaydedilir.
- Threshold failure non-zero exit üretir.

## 6. Custom scan AST round-trip

E2E zinciri:

```text
Rule Builder State
→ Serialized AST Request
→ Gerçek HTTP Request
→ Backend Validation/Normalization
→ Run Resource Rule/Plan Version
→ UI Result Association
```

Doğrulanacak alanlar:

- rule version
- universe filter
- group yapısı
- nodeId politikası
- indicator code/version
- parametreler
- timeframe
- operator
- right operand
- normalized AST semantik eşdeğerliği
- run id ilişkisi

## 7. E2E kuralları

- Request browser network katmanından gözlemlenir.
- Backend'e gerçek request gider.
- Dış provider fake olabilir; scanner API gerçek olmalıdır.
- Validation bypass edilmez.
- Test yalnız UI snapshot'ına dayanmaz.
- Flaky sabit bekleme yerine koşul tabanlı bekleme kullanılır.

## 8. Milestone kalite kapısı

- `pnpm format:check` başarılı
- tüm benchmark senaryoları çalışmış
- eşikler geçmiş
- baseline raporu oluşmuş
- AST round-trip E2E geçmiş
- mevcut 206 runtime, 24 integration ve 2 Playwright testinde regresyon yok
