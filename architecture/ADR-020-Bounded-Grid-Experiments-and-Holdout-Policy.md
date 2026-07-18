# ADR-020 — Bounded Grid Experiments ve Holdout Politikası

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Bir strategy revision'ının farklı parametrelerini karşılaştırmak, kombinasyon üretimi ve veri
aralıkları açıkça sınırlandırılmazsa kontrolsüz hesap maliyeti ve overfitting riski yaratır. Sonuca
bakarak holdout aralığını değiştirmek veya train/test ile çakıştırmak, bağımsız doğrulama anlamını
bozar.

Deney tekrarlarında kombinasyon sırası ve parameter binding değişirse aynı experiment tanımı farklı
run kimlikleri ve sıralama üretebilir. Otomatik optimizasyon sonucu da yatırım önerisi veya garanti
edilmiş optimum olarak sunulmamalıdır.

## Karar

İlk research experiment yöntemi deterministik ve bounded Cartesian grid'dir. Her parametre açık
allowlist veya doğrulanmış `min/max/step` tanımı kullanır. Combination generator:

- strategy parameter schema ve type/range kurallarını doğrular,
- hard combination, symbol, bar, concurrency ve toplam iş bütçesi uygular,
- canonical parameter sırası ve stable combination identity üretir,
- aynı strategy/input/methodology hash'e sahip tamamlanmış backtest'i güvenli biçimde reuse eder,
- retry ve duplicate queue delivery'de aynı combination'ı iki kez sonuçlandırmaz.

Train, validation/test ve holdout aralıkları açık timestamp sınırlarıyla, kronolojik ve
çakışmasızdır. Holdout seçimi experiment başlamadan önce immutable revision içinde sabitlenir;
holdout sonucu görüldükten sonra aynı experiment revision'ında aralık veya seçim ölçütü değişmez.
Warmup verisi yalnız hesaplama girdisidir ve ölçüm dönemine dahil edilmez. Comparison; methodology
uyumu, sample/observation sayısı, turnover, cost warnings ve overfitting diagnostics taşır.

Grid sıralaması deterministiktir; partial/cancelled experiment tamamlanmış gibi sıralanmaz. En iyi
metrik sonucu kesin optimum, gelecek performans garantisi veya yatırım tavsiyesi olarak sunulmaz.

**Random search ve Bayesian optimization bu kararın ve milestone'un kapsamı dışındadır; eklenmez.**
Gelecekte değerlendirilirlerse ayrı ADR, bounded budget ve açık seed/reproducibility policy
gerektirirler.

## Gerekçe

- Bounded grid hesap maliyetini çalıştırmadan önce tahmin edilebilir kılar.
- Canonical kombinasyon üretimi retry ve karşılaştırma sonuçlarını deterministik tutar.
- Önceden sabitlenmiş, çakışmasız holdout overfitting teşhisinin anlamını korur.
- Methodology uyumu ve uyarılar yalnız gerçekten karşılaştırılabilir run'ları yan yana getirir.

## Sonuçlar

### Olumlu

- Experiment kapsamı, maliyeti ve kombinasyon sayısı önceden doğrulanabilir.
- Aynı tanım aynı combination/run identity setini üretir.
- Holdout sonucu train/test tuning'den ayrı raporlanır.
- Cache reuse ve idempotent scheduling gereksiz tekrar hesaplamayı azaltır.
- Overfitting ve cost-free uyarıları karşılaştırma/export boyunca korunur.

### Olumsuz

- Grid boyutu parametre sayısıyla hızla büyür ve hard limit bazı araştırmaları reddeder.
- Coarse step seçimi iyi bölgeleri kaçırabilir; fine step ise bütçeyi tüketebilir.
- Holdout'u immutable tutmak keşif sonrası yeni aralık için yeni experiment revision gerektirir.
- Random ve Bayesian yöntemlerin olası örnekleme verimliliği ilk sürümde kullanılamaz.

## Değerlendirilen alternatifler

Sınırsız grid, kullanıcı tarafından keyfi paralellik, random search ve Bayesian optimization
değerlendirilmiştir. İlk ikisi kapasite ve determinism riskleri taşır. Random ve Bayesian yöntemler
ek seed, model ve açıklanabilirlik politikaları gerektirdiğinden bu milestone'a alınmamıştır.
