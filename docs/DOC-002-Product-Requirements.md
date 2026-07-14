# DOC-002 — Product Requirements Document

**Sürüm:** 1.0  
**Durum:** Taslak

## 1. Ürün özeti

Project Atlas, BIST hisselerini hazır veya kullanıcı tanımlı kurallarla filtreleyen web tabanlı bir tarama ve analiz platformudur.

## 2. Ürün prensipleri

- Sonuç önce, ayrıntı isteğe bağlı
- Her veri zaman damgalı
- Her sinyal açıklanabilir
- Yeni kullanıcı hazır taramayla başlayabilir
- İleri kullanıcı kod yazmadan kural oluşturabilir
- Karmaşık kural oluşturma masaüstü önceliklidir

## 3. Ana navigasyon

- Dashboard
- Tarayıcı
- Hazır Taramalar
- Kayıtlı Taramalar
- Hisseler
- Watchlist
- Alarmlar
- Portföy
- Backtest
- Bildirimler
- Hesap
- Admin

## 4. Dashboard

Gösterimler:

- BIST endeks özetleri
- en çok yükselen ve düşenler
- yüksek hacim ve göreli hacim
- yeni teknik sinyaller
- sektör performansı
- watchlist özeti
- tetiklenen alarmlar
- veri tazelik bilgisi

UI durumları: loading, partial, stale data, provider unavailable, empty state ve unauthenticated.

## 5. Tarayıcı

### Kural bileşenleri

- veri alanı veya indikatör
- indikatör parametresi
- zaman dilimi
- operatör
- sayı veya başka veri alanı
- AND/OR grubu
- iç içe grup

### İlk operatörler

- eşittir / eşit değildir
- büyüktür / büyük eşittir
- küçüktür / küçük eşittir
- aralıktadır
- yukarı keser / aşağı keser
- yüzde artmıştır / azalmıştır
- periyodun en yükseği / düşüğü
- yüzde yakınındadır
- doğru / yanlış

### İlk zaman dilimleri

- 15 dakika
- 30 dakika
- 1 saat
- 4 saat
- günlük
- haftalık

### Sonuç tablosu

- sembol
- şirket adı
- son fiyat
- değişim
- hacim
- göreli hacim
- piyasa değeri
- sektör
- eşleşen koşul sayısı
- veri zamanı

Kolonlar sıralanabilir, gizlenebilir ve sabitlenebilir.

## 6. Hazır tarama kategorileri

- Trend
- Momentum
- Hacim
- Volatilite
- Hareketli Ortalama
- Kırılım
- Aşırı Alım / Aşırı Satım
- Mum Formasyonları
- Temel Değerleme
- Büyüme
- Temettü
- Risk
- Çoklu Zaman Dilimi

Her hazır tarama ad, açıklama, koşullar, kullanıcı seviyesi, veri gereksinimi ve güncellenme tarihi taşır.

## 7. İlk indikatör seti

### Trend
SMA, EMA, WMA, HMA, Supertrend, ADX, DMI, Parabolic SAR, Ichimoku temel bileşenleri.

### Momentum
RSI, Stochastic, Stochastic RSI, MACD, CCI, ROC, Williams %R, MFI.

### Hacim
OBV, CMF, VWAP, Volume SMA, Relative Volume, Accumulation/Distribution.

### Volatilite
ATR, Bollinger Bands, Keltner Channel, Standard Deviation, Donchian Channel.

## 8. Kayıtlı taramalar

Kullanıcı taramayı adlandırabilir, açıklayabilir, etiketleyebilir, kopyalayabilir, aktif/pasif yapabilir ve tekrar çalıştırabilir. Paylaşım varsayılan olarak kapalıdır.

## 9. Alarm

Kaynaklar: kayıtlı tarama, sembol koşulu, fiyat seviyesi, yüzde değişim, hacim ve indikatör kesişimi.

Kanallar: uygulama içi, e-posta, web push; webhook ve Telegram sonraki sürüm olabilir.

Tekrar seçenekleri: ilk oluşum, her yeni bar, günlük bir kez, koşul sıfırlanıp yeniden oluşunca.

## 10. Hisse detay sayfası

- şirket özeti
- fiyat ve performans
- grafik
- teknik özet
- temel oranlar
- aktif tarama eşleşmeleri
- watchlist ve alarm işlemleri
- veri kaynağı ve zaman bilgisi

## 11. Watchlist

Birden fazla liste, not, etiket, sıralama, hızlı tarama ve toplu alarm temel ihtiyaçlardır.

## 12. Portföy

Manuel işlem girişi, adet, maliyet, gerçekleşen/gerçekleşmemiş kâr-zarar, sektör dağılımı, ağırlık, toplam değer ve nakit pozisyonu desteklenir.

## 13. Paketler

### Guest
Sınırlı dashboard ve hazır tarama.

### Free
Watchlist, sınırlı kayıtlı tarama ve alarm.

### Premium
Daha yüksek kotalar, gelişmiş indikatörler, çoklu zaman dilimi, dışa aktarma ve backtest erişimi.

### Admin
Kullanıcı, yetki, hazır tarama, veri sağlayıcı ve sistem sağlık yönetimi.

## 14. Ana kullanıcı hikâyeleri

### US-001 — Hazır tarama çalıştırma

Kullanıcı hazır taramayı seçip eşleşen hisseleri veri zamanı ve açıklamayla görür.

### US-002 — Özel tarama oluşturma

Kullanıcı RSI ve EMA koşullarını AND ile birleştirir, parametreleri değiştirir ve geçerli kuralı kaydeder.

### US-003 — Alarm alma

Kullanıcı kayıtlı tarama yeni eşleşme bulduğunda seçtiği kanaldan bildirim alır; aynı bar için tekrar bildirim engellenir.
