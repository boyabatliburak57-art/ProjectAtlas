# ADR-019 — Varsayılan Commission ve Slippage Modeli

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

İşlem maliyetlerini yok sayan bir backtest, özellikle yüksek turnover stratejilerinde uygulanabilir
olmayan performans üretebilir. Bununla birlikte broker ve piyasa koşulları farklı olduğundan tek bir
parasal değer her çalışma için doğru değildir. Modelin versioned, bounded ve sonuçta görünür olması
gerekir.

Slippage yönünün veya commission uygulama sırasının implicit olması cash, quantity ve P&L
hesaplarını farklılaştırır. Cost-free çalışma araştırma amacıyla faydalı olsa da gerçekçi varsayılan
gibi sunulmamalıdır.

## Karar

Varsayılan execution-cost policy şu açıklanabilir bileşenleri kullanır:

- fill notional üzerinden yüzde commission,
- emir başına minimum commission,
- buy fiyatını artıran ve sell fiyatını azaltan sabit basis-point slippage,
- gerekiyorsa ayrı ve versioned sabit fee/tax bileşenleri.

İlk model doğrusal ve deterministiktir. Slippage fill fiyatına yönlü olarak uygulanır; ardından
commission, fee ve tax hesaplanır. Buy işleminde toplam cash gereksinimi, sell işleminde net
proceeds bu maliyetlerden sonra yeniden doğrulanır. Negative cash, short selling veya leverage
varsayılan kapsamda açılmaz. Bütün para ve oran hesapları repository decimal policy'sini kullanır;
ara adımlarda kontrolsüz binary float veya gereksiz rounding uygulanmaz.

Cost policy; model code/version, percentage/minimum değerleri, slippage bps, fee/tax ayarları,
currency ve rounding policy ile run request, methodology, result, comparison, cache ve
reproducibility identity'sinde bulunur. Parametreler belgelenmiş alt/üst sınırlarla doğrulanır.

Cost-free backtest yalnız açık opt-in ile çalışır. Böyle bir sonuç request, response, UI,
comparison ve export üzerinde kaldırılması mümkün olmayan görünür `COST_FREE_BACKTEST` uyarısı
taşır; varsayılan model veya production-benzeri sonuç olarak etiketlenemez.

## Gerekçe

- Basit yüzde + minimum commission ve sabit bps slippage fixture ile açıklanabilir ve test edilebilir.
- Yönlü slippage alış/satış maliyetini tutarlı biçimde kötüleştirir.
- Versioned parametreler sonuç farkının maliyet modelinden kaynaklandığını gösterir.
- Cost-free warning gerçekçilik sınırını kullanıcıya ve export tüketicisine taşır.

## Sonuçlar

### Olumlu

- Varsayılan performans işlem maliyetlerini hesaba katar.
- Cash, realized P&L ve turnover maliyeti deterministik yeniden üretilebilir.
- Farklı cost senaryoları açık methodology metadata'sıyla karşılaştırılabilir.
- Cost-free araştırmalar gerçekçi sonuçlarla sessizce karışmaz.

### Olumsuz

- Sabit bps slippage likidite, spread ve order-size etkilerini tam modellemez.
- Broker bazlı minimum ve vergi farklılıkları ayrıca konfigüre edilmelidir.
- Cost policy değişimi geçmiş cache ve karşılaştırmaların invalidation'ını gerektirir.
- Aşırı basit model düşük likiditeli enstrümanlarda gerçekleşme maliyetini eksik tahmin edebilir.

## Değerlendirilen alternatifler

Varsayılan sıfır maliyet, rastlantısal slippage ve tam order-book simulation değerlendirilmiştir.
Sıfır maliyet iyimser ve yanıltıcıdır. Rastlantısal model determinism ve seed karmaşıklığı getirir.
Order-book simulation ise mevcut veri ve milestone kapsamını aşar. Bu nedenle versioned doğrusal
maliyet modeli seçilmiştir.
