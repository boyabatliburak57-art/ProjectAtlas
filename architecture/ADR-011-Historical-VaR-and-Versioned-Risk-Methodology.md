# ADR-011 — Historical VaR ve Sürümlü Risk Metodolojisi

**Durum:** Accepted  
**Tarih:** 2026-07-16

## Bağlam

Volatilite, beta, drawdown, yoğunlaşma ve kayıp dağılımı metrikleri; return convention, tarih
hizalaması, minimum observation, annualization ve quantile seçimine bağlıdır. Bu politikaların
sessizce değişmesi aynı veri için farklı ve açıklanamaz risk sonuçları üretir.

## Karar

İlk dağılım-temelli kayıp metriği Historical Value at Risk olacaktır. İlk sürüm %95 ve %99 güven
düzeylerini, bir işlem günü horizon'ını ve versioned minimum observation politikasını destekler.
Historical VaR geçmiş return dağılımının versioned quantile convention'ından hesaplanır; kesin veya
garantili gelecek kaybı olarak sunulmaz. Veri yeterliyse VaR eşiğinin ötesindeki ortalama kayıp
Expected Shortfall olarak ayrıca sunulabilir.

Risk policy aşağıdaki seçimleri birlikte version'lar:

- return convention ve annualization factor,
- portfolio/benchmark tarih hizalama kuralı,
- minimum observation sayısı,
- quantile ve interpolation convention'ı,
- benchmark seçimi ve formula implementation sürümü,
- missing, stale ve isteğe bağlı forward-fill davranışı.

Her metrik `value`, `status`, `reason`, `observationCount` ve `methodologyVersion` taşır. Eksik gün
sıfır getiri sayılmaz; forward-fill yalnız açık policy ile uygulanır. Yetersiz veri, sıfır benchmark
varyansı, geçersiz sayı veya hesaplanamayan sonuç ilgili metrikte `notEvaluable` üretir ve bütün risk
snapshot'ını düşürmez.

Risk matematiği saf fonksiyonlarda tutulur. Para ve ledger değerleri kalıcı katmanda decimal olarak
korunur; istatistiksel hesaplarda JavaScript `number` yalnız deterministic fixture, açık tolerance
ve NaN/Infinity guard'larıyla kullanılabilir. Risk snapshot anahtarı `ledgerVersion`, valuation
series version, analysis range, benchmark, risk policy version ve data cutoff'u içerir.

## Gerekçe

- Historical VaR ilk sürüm için açıklanabilir ve deterministik fixture ile doğrulanabilir.
- Methodology versioning, formül veya policy değişikliğinin geçmiş sonuçları sessizce yeniden
  anlamlandırmasını engeller.
- Metrik bazlı status, kısmi veri kalitesinde kullanılabilir sonuçların sunulmasını sağlar.
- Saf matematik katmanı referans fixture ve tolerance testlerini kolaylaştırır.

## Sonuçlar

Olumlu sonuçlar; tekrarlanabilir risk snapshot'ları, açık data-quality semantiği ve metodoloji audit
izidir. Olumsuz sonuçlar; policy registry, daha fazla snapshot invalidation ve versionlar arası
karşılaştırmada metodoloji bilgisini taşıma zorunluluğudur.

## Değerlendirilen alternatifler

Parametric VaR, Monte Carlo VaR ve versionlanmamış tek formül değerlendirilmiştir. Parametric ve
Monte Carlo yaklaşımları ek dağılım/model varsayımları getirir. Versionlanmamış yaklaşım ise geçmiş
sonuçların açıklanabilirliğiyle çelişir. Bu nedenle ilk model Historical VaR olarak seçilmiştir.
