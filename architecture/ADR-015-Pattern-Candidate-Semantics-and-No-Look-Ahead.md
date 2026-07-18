# ADR-015 — Pattern Candidate Semantiği ve No-Look-Ahead Kuralı

**Durum:** Accepted  
**Tarih:** 2026-07-18

## Bağlam

Mum, trend, kırılım ve geometrik teknik formasyonlar kapalı fiyat/hacim barlarından üretilir.
Özellikle double top/bottom ve triangle gibi geometrik şekiller detection anında ancak bir aday
olabilir; sonraki barlar kırılımı doğrulayabilir veya adayı geçersiz kılabilir. Future barların
candidate üretiminde kullanılması look-ahead bias yaratır ve geçmiş fixture sonuçlarını gerçekte o
anda bilinmeyen veriyle iyileştirir.

Tek bir confidence değeri kanıtları gizleyebilir ve algoritmik adayı kesin gelecek tahmini gibi
gösterebilir. Algorithm veya parametre davranışının sessizce değişmesi de geçmiş detection'ların
anlamını bozar.

## Karar

Pattern definitions saf, deterministik ve versioned registry kayıtlarıdır. Candidate detection
yalnız detection barı dahil o ana kadar mevcut **kapalı** barları kullanır. Intrabar detection açık
bir feature/policy olmadan çalışmaz. Future barlar candidate creation input'u olamaz; yalnız daha
sonraki ayrı state transition ile `confirmed` veya `invalidated` durumuna geçiş sağlayabilir.

State machine:

```text
candidate → confirmed
candidate → invalidated
```

Confirmation candidate kaydını overwrite etmez; transition zamanı, ilgili closed bar ve kullanılan
algorithm version ile audit edilir. Her instance pattern code/version, timeframe, adjustment mode,
start/end/detected bar, evidence points, direction, data cutoff, state ve warnings taşır.

Deduplication identity en az şudur:

```text
instrument + timeframe + patternCode + patternVersion
+ startBar + keyEvidenceHash
```

Confidence kullanılırsa açık bileşenler, versioned ağırlıklar ve minimum evidence ile hesaplanır;
gizli AI skoru değildir. Missing volume, kısa seri veya algorithm input hatası sahte negatif ya da
NaN üretmez; metric/instance düzeyinde notEvaluable veya warning döner.

Pattern candidate sonucu **kesin tahmin, fiyat hedefi veya yatırım tavsiyesi değildir**. API ve UI
candidate/confirmed/invalidated ayrımını, evidence noktalarını, algorithm version'ı ve data cutoff'u
gösterir. Provider raw market verisi önce normalize market-data portundan geçer; ham provider
payload'u domain pattern modeline veya UI'ya doğrudan bağlanmaz.

## Gerekçe

- No-look-ahead, fixture ve backtest sonuçlarının zamanda erişilebilir veriye dayanmasını sağlar.
- Ayrı state transition detection ile sonraki doğrulamayı birbirine karıştırmaz.
- Versioned algorithm ve evidence geçmiş adayların açıklanabilirliğini korur.
- Deduplication worker retry ve duplicate closed-bar eventlerinde tek instance üretir.
- Açık candidate dili kullanıcıya algoritmik belirsizliği doğru aktarır.

## Sonuçlar

### Olumlu

- Pattern sonuçları deterministik positive/near-miss fixture'larla doğrulanabilir.
- Candidate creation future barlardan etkilenmez.
- Confirmation/invalidation geçmişi audit edilebilir ve duplicate instance oluşmaz.
- Chart ve API evidence noktalarını ve version bilgisini açıklayabilir.
- Pattern adaylarının kesin tahmin gibi yanlış sunulma riski azalır.

### Olumsuz

- Candidate ve transition persistence'ı tek boolean sinyalden daha karmaşıktır.
- Geometrik evidence üretimi ve deduplication hash policy'si versionlanmalıdır.
- Confirmation için sonraki closed-bar eventlerini işleyen ek worker state gerekir.
- Algorithm version değişimi eski ve yeni instance'ların birlikte yönetilmesini gerektirir.

## Değerlendirilen alternatifler

Future barlarla geriye dönük kesin pattern işaretleme, candidate/confirmed ayrımı olmayan tek state
ve açıklamasız confidence skoru değerlendirilmiştir. İlki look-ahead bias yaratır; ikincisi
algoritmik belirsizliği gizler; üçüncüsü sonucu açıklanamaz hale getirir. Bu nedenle üç durumlu,
evidence taşıyan ve versioned yaklaşım seçilmiştir.
