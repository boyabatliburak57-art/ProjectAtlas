# ADR-013 — Chart Adjustment Mode ve Data Cutoff Politikası

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Symbol chart; OHLCV barları, indicator overlay/panel serileri, corporate action ve pattern
marker'ları ile kullanıcıya özel alert/transaction marker'larını aynı zaman ekseninde birleştirir.
Raw, split-adjusted ve total-return-adjusted seriler aynı tarih için farklı fiyat anlamları taşır.
Adjustment seçiminin implicit olması veya farklı serilerin aynı cache identity'sini paylaşması
yanlış fiyat ve indikatör sonuçlarının sunulmasına yol açabilir.

Quote, bar, indicator ve marker kaynaklarının cutoff'ları da farklı olabilir. Bu farkı gizlemek
chart ile sembol özetinin gerçekte karşılaştırılamayan verileri aynı anın verisi gibi göstermesine
neden olur.

## Karar

Her chart request desteklenen bir `adjustmentMode` seçimini açıkça taşır. İlk policy raw,
split-adjusted ve veri yeterliyse total-return-adjusted serileri ayrı anlam ve capability olarak
ele alır. Raw ve adjusted seriler aynı response içinde karıştırılmaz ve **aynı cache anahtarını
kullanamaz**.

Chart cache identity en az şunları içerir:

```text
instrument + timeframe + range + adjustmentMode
+ dataCutoffAt + adjustmentPolicyVersion
+ indicator codes/versions/params hash
+ pattern/corporate-action versions + authorized marker context
```

Application service, barları seçilen adjustment policy ile okur; indicator'ları aynı ayarlanmış
seri üzerinde batch executor'da hesaplar ve overlay/panel/marker timestamps değerlerini bar
eksenine normalize eder. Open bar açıkça işaretlenir; eksik bar sıfır değerli sentetik bar olarak
üretilmez.

Chart ve quote mümkünse aynı mantıksal `dataCutoffAt` kullanır. Quote, bar, overlay veya marker
cutoff'ları farklıysa response kaynak cutoff'ları ve warning taşır; fark sessizce gizlenmez.
Corporate action adjustment policy ve indicator versions response metadata'sında bulunur.

Kullanıcı alert/transaction marker'ları yalnız authentication ve ownership kontrolünden sonra
eklenir ve kullanıcı bağlamı cache identity'sine dahil edilir. Provider adapter ham market verisini
normalize eder; provider raw payload'u, hata gövdesi veya provider'a özgü şema domain chart
modeline ya da UI'ya doğrudan bağlanmaz.

## Gerekçe

- Explicit adjustment mode fiyat serisinin anlamını kullanıcı ve istemci için görünür kılar.
- Cache ayrımı raw/adjusted veri zehirlenmesini ve yanlış overlay reuse'unu engeller.
- Tek eksen ve versioned inputs, indicator ve marker hizalamasını yeniden üretilebilir yapar.
- Açık cutoff metadata'sı quote/chart tutarsızlığını saklamak yerine yönetilebilir kılar.
- Ownership-bound cache, kullanıcı marker'larının başka kullanıcıya sızmasını engeller.

## Sonuçlar

### Olumlu

- Raw ve adjusted chart sonuçları semantik olarak ayrılır.
- Indicator overlay'leri kullanılan bar serisi ve indicator version ile açıklanabilir olur.
- Cache invalidation corporate action, indicator ve pattern revision'larına bağlanabilir.
- Missing/open bar ve farklı cutoff durumları kullanıcıya doğru biçimde gösterilir.
- User marker IDOR riski açık ownership ve cache-context kuralıyla sınırlandırılır.

### Olumsuz

- Adjustment mode başına ayrı cache entry ve hesaplama maliyeti oluşur.
- Corporate action revision'ları geçmiş adjusted serilerin yeniden üretilmesini gerektirir.
- Birleşik response birden fazla cutoff warning'i taşıyabilir ve UI açıklaması karmaşıklaşabilir.
- Overlay/version/authorization bileşenleri cache key cardinality'sini artırır.

## Değerlendirilen alternatifler

Tek varsayılan adjusted seri, raw ve adjusted veriyi tek cache key altında tutma ve UI'da indicator
hesaplama değerlendirilmiştir. İlk iki yaklaşım fiyat anlamını ve cache doğruluğunu bozar. UI
hesabı ise Indicator Engine versioning, fixture ve server validation sözleşmelerini bypass eder.
