# ADR-016 — Closed-Bar Signal ve Next-Open Varsayılan Execution

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Backtest sonucu, bir sinyalin hangi veriyle üretildiğine ve emrin hangi anda hangi fiyatla
gerçekleştiğine doğrudan bağlıdır. Kapanış fiyatını kullanan bir stratejinin aynı barın kapanışında
işlem gördüğünü varsaymak, sinyal kesinleşmeden erişilemeyen bir fiyatı fill fiyatı olarak kullanma
riski taşır. Bu yaklaşım look-ahead bias, gerçekçi olmayan fill ve iyimser performans üretir.

İntraday ve çoklu timeframe stratejilerinde open bar verisinin kapalı bar gibi kullanılması da aynı
problemi büyütür. Eksik veya işlem görmeyen bir sonraki barı sentetik fiyatla doldurmak ise veri
kalitesi sorununu gizler.

## Karar

Varsayılan backtest execution policy aşağıdaki zaman çizelgesini kullanır:

```text
kapalı bar tamamlanır → sinyal hesaplanır → order intent oluşur
→ sonraki işlem yapılabilir barın açılışında execution denenir
```

Sinyal ve indicator hesapları yalnız event anında erişilebilir kapalı barları kullanır. Warmup ve
çoklu timeframe girdileri de kendi timeframe'lerinde kapanmış olmalıdır. Varsayılan fill fiyatı
sonraki kullanılabilir barın open değeridir; bar eksikse sıfır veya sentetik fill üretilmez. Emir,
versioned missing-bar/execution policy uyarınca ertelenir, reddedilir veya notEvaluable yapılır.

Same-bar close execution yalnız açıkça seçilen bir araştırma modu olabilir. Bu mod:

- varsayılan olamaz,
- ayrı bir execution policy version taşır,
- request, sonuç, karşılaştırma ve export üzerinde görünür `SAME_BAR_EXECUTION_RESEARCH_MODE`
  uyarısı üretir,
- gerçekçi next-open sonuçlarıyla uyarısız biçimde karşılaştırılamaz.

Execution policy, bar adjustment mode, timeframe, data cutoff ve policy version run methodology
metadata'sına ve reproducibility hash'ine dahil edilir.

## Gerekçe

- Closed-bar sinyal, sinyal anında gerçekten bilinen veri sınırını açıklar.
- Next-open execution sinyal üretimi ile fill arasında nedensel zaman sırası kurar.
- Eksik barı sentetik fiyatla doldurmamak veri kalitesi sorununu görünür tutar.
- Same-bar modunu ayrı ve uyarılı tutmak araştırma esnekliğini varsayılan doğruluktan ayırır.
- Versioned policy aynı strateji revision'ının hangi execution varsayımıyla çalıştığını kanıtlar.

## Sonuçlar

### Olumlu

- Varsayılan sonuçlarda same-bar look-ahead riski azaltılır.
- Sinyal ve fill zamanları audit edilebilir olur.
- Retry ve yeniden çalıştırma aynı kapalı bar ve execution policy ile aynı sonucu üretir.
- Kullanıcı gerçekçi varsayımla araştırma amaçlı iyimser modu birbirinden ayırabilir.

### Olumsuz

- Next-open gap'leri, close-to-close modellere göre daha yüksek ve değişken gerçekleşme farkı
  yaratabilir.
- Son veri barında oluşan sinyal, sonraki open bulunmadığında execute edilemez.
- Çoklu timeframe kapanış takvimi ve eksik bar davranışı engine'i karmaşıklaştırır.
- Same-bar araştırma moduyla üretilen eski çalışmalar ayrı warning ve filtreleme gerektirir.

## Değerlendirilen alternatifler

Varsayılan same-bar close, next-bar close ve sentetik next-open fill değerlendirilmiştir. Same-bar
close erişilemeyen fiyat ve look-ahead riski taşır. Next-bar close gereksiz ek gecikme yaratır.
Sentetik fill ise eksik piyasa verisini gerçek işlem gibi gösterir. Bu nedenle closed-bar sinyal ve
next available open varsayılanı seçilmiştir.
