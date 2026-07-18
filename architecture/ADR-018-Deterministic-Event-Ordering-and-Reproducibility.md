# ADR-018 — Deterministik Event Ordering ve Reproducibility

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Aynı timestamp içinde corporate action, universe değişimi, fiyat barı, stop, exit, rebalance ve
entry olayları birlikte bulunabilir. Sıra açık değilse unordered collection davranışı, worker retry
veya farklı concurrency aynı input için farklı trade, cash ve sonuç üretir. Sistem saati, implicit
rounding ve kararsız score eşitliği de tekrar üretilebilirliği bozar.

Checkpoint'ten devam eden bir run'ın baştan çalışan run ile aynı sonucu üretmesi ve araştırma
karşılaştırmalarının yalnız tanımlı input farklarından etkilenmesi gerekir.

## Karar

Engine saf ve deterministik bir event timeline işler. Timeline ordering policy versioned'dır ve ilk
policy aynı mantıksal zamanda şu sıralamayı kullanır:

1. Event anında erişilebilir universe, corporate action ve financial revision durumunu uygula.
2. Forced exit işlemlerini değerlendir.
3. Stop-loss, take-profit ve trailing-stop exit işlemlerini değerlendir.
4. Strategy exit sinyallerini uygula.
5. Rebalance sell emirlerini uygula.
6. Entry ve rebalance buy emirlerini uygula.
7. Valuation, metric, checkpoint ve terminal kayıtlarını üret.

Aynı sınıftaki event'ler normalized instrument identity, açık strategy priority, score ve benzersiz
stable event identity ile total order kazanır. Score eşitliğinde stable instrument/event identity
son tie-breaker'dır. Hiçbir karar database row order, map/set iteration order veya worker
concurrency'ye bırakılamaz.

Decimal arithmetic, rounding scale ve rounding mode policy version ile tanımlanır. Engine sistem
saatini kullanmaz; evaluation time event timeline'dan gelir. Varsayılan engine yolunda randomness
yoktur. Gelecekte randomness gerektiren ayrı bir araştırma özelliği eklenirse seed zorunlu olur ve
seed run identity'sine dahil edilir.

Reproducibility identity en az şunların canonical hash'ini taşır:

```text
strategyRevision + normalizedParameters + universeSnapshot
+ market/fundamental/corporateAction revisions + dataCutoff
+ execution/cost/rounding/eventOrdering policy versions
+ engineVersion + explicitSeed(if applicable)
```

Checkpoint; son işlenen total-order key, portfolio/cash/position state, metric accumulator ve input
hash'lerini saklar. Retry aynı checkpoint'i idempotent sürdürür; hash veya policy uyuşmazlığında
resume reddedilir.

## Gerekçe

- Total ordering concurrency ve persistence sırasını sonuç semantiğinden ayırır.
- Versioned event ve rounding policy geçmiş sonucu yeniden üretilebilir kılar.
- Canonical input hash cache reuse, comparison ve audit için doğrulanabilir kimlik sağlar.
- Checkpoint identity retry sırasında duplicate veya farklı sonuç üretilmesini engeller.

## Sonuçlar

### Olumlu

- Aynı input ve engine/policy sürümleri byte-stable sonuç üretebilir.
- Baştan çalışma ile checkpoint resume sonucu karşılaştırılabilir.
- Worker concurrency sonucu değiştirmeden performans için ayarlanabilir.
- Tie-break ve same-timestamp davranışı fixture testleriyle doğrulanabilir.

### Olumsuz

- Her event için stable identity ve sıralama anahtarı üretmek ek maliyet getirir.
- Policy değişiklikleri yeni methodology version ve sonuç invalidation gerektirir.
- Canonical serialization ve decimal policy'nin tüm engine sınırlarında korunması gerekir.
- Eski engine sürümlerini yeniden çalıştırmak artifact/version saklama yükü oluşturur.

## Değerlendirilen alternatifler

Database doğal sırası, arrival-order queue processing ve timestamp dışında tie-break taşımayan
sıralama değerlendirilmiştir. Bu yaklaşımlar retry, concurrency ve altyapı değişimlerinde kararsız
sonuç ürettiği için reddedilmiştir.
