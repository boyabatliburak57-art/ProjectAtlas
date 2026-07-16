# ADR-010 — Portfolio Performansında TWR ve XIRR Ayrımı

**Durum:** Accepted  
**Tarih:** 2026-07-16

## Bağlam

Portföy performansı hem yatırım stratejisinin dış nakit akışlarından arındırılmış sonucunu hem de
kullanıcının yatırdığı paranın zamanlama ve büyüklüğüne bağlı deneyimini açıklamalıdır. Tek bir
getiri oranı bu iki soruyu aynı anda doğru yanıtlamaz.

## Karar

Time-Weighted Return ve XIRR/Money-Weighted Return ayrı, isimlendirilmiş metrikler olarak
hesaplanacak ve API ile kullanıcı deneyiminde birbirinin yerine kullanılmayacaktır.

TWR, dış nakit akışlarıyla ayrılan alt dönem getirilerini geometrik olarak zincirler:

```text
TWR = product(1 + subperiodReturn) - 1
```

XIRR, düzensiz tarihli dış nakit akışları ile dönem sonu değeri için yıllıklaştırılmış iskonto
oranını çözer. Solver toleransı, maksimum iterasyon, tarih convention'ı ve başarısızlık davranışı
versioned policy'nin parçasıdır. Yakınsamayan, geçerli kökü olmayan veya belirsiz çoklu sonuç veren
seriler sayı uydurmak yerine açık `notEvaluable` döndürür.

Her iki metrik aynı valuation series, para birimi, analysis range ve `dataCutoff` ile üretilir.
Benchmark aynı tarih aralığı ve cutoff'a hizalanır. Price return ve temettüyü içerebilen total
return ayrı tutulur. Geçmiş tarihli işlem, reversal, kurumsal aksiyon veya fiyat revizyonu ilgili
performance cache'ini invalidate eder.

## Gerekçe

- TWR, dış contribution ve withdrawal etkisini ayırarak strateji karşılaştırmasını destekler.
- XIRR, kullanıcının gerçek nakit akışı zamanlamasına ve büyüklüğüne duyarlı sonucu gösterir.
- Ayrı metrikler, aynı değerin iki farklı anlamla sunulmasını engeller.
- Versioned solver ve cutoff, geçmiş sonuçların açıklanabilir ve yeniden üretilebilir kalmasını
  sağlar.

## Sonuçlar

Olumlu sonuçlar; daha doğru performans açıklaması, benchmark hizalaması ve kontrollü failure
semantiğidir. Olumsuz sonuçlar; iki ayrı metodoloji, daha fazla fixture ve solver edge-case testi
gerektirmesidir.

TWR veya XIRR gelecek getiri garantisi değildir. XIRR sonucu olmayan serilerde TWR mevcutsa kendi
status'uyla sunulmaya devam eder; tek metriğin hesaplanamaması bütün performance çıktısını düşürmez.

## Değerlendirilen alternatifler

Yalnız basit dönem getirisi, yalnız TWR ve yalnız XIRR değerlendirilmiştir. Her biri dış nakit akışı
etkisi veya kullanıcı deneyimi sorularından birini eksik bıraktığı için tek başına seçilmemiştir.
