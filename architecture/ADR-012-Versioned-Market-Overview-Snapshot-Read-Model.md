# ADR-012 — Market Overview için Sürümlü Snapshot Read Model

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

BIST market overview; endeks özeti, breadth, sektör toplulaştırmaları ve sıralama listelerini aynı
ekranda sunar. Bu hesaplar aktif enstrüman evreni, kapalı barlar, indikatör sürümleri ve veri kalite
durumları üzerinde çalışır. Her HTTP isteğinde tam evreni yeniden hesaplamak öngörülemez gecikme,
birbirinden farklı cutoff'ların aynı yanıtta karışması ve aynı input için farklı ranking sonuçları
üretme riski taşır.

Eksik verili semboller breadth paydasına sessizce eklenemez. Retry edilen snapshot işleri de aynı
mantıksal piyasa görünümü için duplicate kayıt oluşturmamalıdır.

## Karar

Market overview ağır hesapları request sırasında değil, kapalı piyasa verisi ve versioned policy
input'larından üretilen PostgreSQL snapshot read model'larıyla sunulacaktır.

Snapshot identity en az şu bileşenleri taşır:

```text
market + timeframe + universeVersion + dataCutoffAt
+ calculationPolicyVersion + generationId
```

Index, breadth, sector ve ranking snapshot'ları aynı mantıksal üretimde ortak `generationId` ve
`dataCutoffAt` kullanır. Birleşik response farklı generation veya cutoff kullanmak zorunda kalırsa
bu farkı metadata ve warning ile açıklar; sessizce tek generation gibi sunmaz. Snapshot status,
`evaluatedCount`, `excludedCount`, stale/partial durumu ve kullanılan indicator/policy sürümlerini
taşır.

Yeni closed bar veya universe/policy/indicator version değişimi ilgili snapshot'ı invalid eder ve
idempotent rebuild tetikler. Ranking read model stable sort ve benzersiz tie-breaker ile cursor
pagination sağlar. PostgreSQL güvenilir kaynaktır; Redis yalnız kısa ömürlü cache olabilir ve Redis
kaybında PostgreSQL fallback kullanılır.

Provider adapter'ı ham provider payload'unu normalize edilmiş market-data portlarına çevirir.
Provider raw verisi, provider hata gövdesi veya provider'a özgü alanlar domain read model'ına ya da
UI response'una doğrudan bağlanmaz.

## Gerekçe

- Tek generation ve cutoff, market kartlarının karşılaştırılabilir olmasını sağlar.
- Önceden üretilmiş read model, full-universe hesap maliyetini HTTP latency'sinden ayırır.
- Policy ve input sürümleri geçmiş snapshot'ların açıklanabilirliğini korur.
- Evaluated/excluded ayrımı missing veriyi sıfır veya başarısız koşul gibi göstermeyi engeller.
- Idempotent identity, job retry sırasında duplicate snapshot oluşmasını engeller.

## Sonuçlar

### Olumlu

- Bounded ve ölçülebilir market overview sorguları elde edilir.
- Aynı input aynı generation içeriğini deterministik olarak üretir.
- Stale, partial ve excluded veri kalitesi kullanıcıya açıkça taşınır.
- Ranking cursor ve cache invalidation davranışları versioned identity ile test edilebilir olur.
- Provider değişiklikleri domain ve UI sözleşmesini doğrudan etkilemez.

### Olumsuz

- Snapshot üretim, reconciliation ve invalidation işleri ek operasyonel karmaşıklık getirir.
- Read model kaynak verinin çok kısa süre gerisinde kalabilir; freshness metadata zorunludur.
- Policy veya universe version değişimleri toplu rebuild maliyeti yaratabilir.
- Generation'lar arası partial failure için reconciliation ve gözlemlenebilirlik gerekir.

## Değerlendirilen alternatifler

Her request'te tam evren hesaplama, yalnız Redis'te materialize etme ve cutoff/version taşımayan
tek snapshot değerlendirilmiştir. İlki latency ve tutarlılık hedeflerini karşılamaz. Yalnız Redis
güvenilir persistence sağlamaz. Version'sız snapshot ise policy değişikliklerini ve stale sonucu
açıklanamaz hale getirir.
