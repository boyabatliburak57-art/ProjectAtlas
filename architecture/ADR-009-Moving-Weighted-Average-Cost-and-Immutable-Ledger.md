# ADR-009 — Moving Weighted Average Cost ve Immutable Portfolio Ledger

**Durum:** Accepted  
**Tarih:** 2026-07-16

## Bağlam

Portföy pozisyonları, nakit bakiyesi ve gerçekleşen kâr/zarar; manuel giriş, CSV import,
geriye tarihli işlem ve kurumsal aksiyonlardan sonra aynı sonuçla yeniden üretilebilmelidir.
Finalized bir işlemin yerinde değiştirilmesi audit izini ve geçmiş projection'ların dayanağını
ortadan kaldırır. İlk sürüm ayrıca tek, açıklanabilir bir analitik maliyet yöntemine ihtiyaç duyar.

## Karar

Posted transaction ledger finansal olayların tek doğruluk kaynağıdır. Position, cash, valuation ve
performance kayıtları ledger'dan yeniden üretilebilen projection veya cache'dir.

İlk analitik maliyet yöntemi Moving Weighted Average Cost olacaktır:

```text
newAverageCost =
  (previousQuantity × previousAverageCost
   + buyQuantity × buyUnitPrice
   + allocatedBuyFees)
  / newQuantity
```

Satış kalan pozisyonun ortalama maliyetini değiştirmez. Gerçekleşen kâr/zarar, net satış geliri ile
satılan miktarın işlem anındaki ortalama maliyeti arasındaki farktır. Split ve bonus share toplam
maliyet bazını değiştirmeden miktar ile birim maliyeti ters yönlerde düzenler.

Posted işlem overwrite edilmez veya doğrudan silinmez. Düzeltme, orijinal kaydı koruyan bağlı bir
reversal ve gerekiyorsa yeni replacement transaction ile yapılır. Posting veya reversal
`ledgerVersion` değerini artırır; projection rebuild ve snapshot invalidation bu version üzerinden
yürütülür. Replay, effective tarih ve kalıcı deterministic sequence sırasını kullanır.

Para ve miktar kalıcı veride `numeric/decimal`, uygulama sınırlarında kayıpsız decimal string olarak
taşınır. Gereksiz ara yuvarlama yapılmaz.

## Gerekçe

- Aynı ledger aynı position, cash ve realized P&L sonucunu üretir.
- Reversal geçmişi sessizce yeniden yazmadan düzeltme ve audit sağlar.
- Moving weighted average, parçalı alış ve satışlarda tek ve açıklanabilir maliyet bazını korur.
- `ledgerVersion`, projection ve cache geçerliliğini açık hale getirir.

## Sonuçlar

Olumlu sonuçlar; deterministic rebuild, idempotent projection, açık audit izi ve basit maliyet
açıklamasıdır. Olumsuz sonuçlar; reversal/replacement akışının ek kayıt üretmesi, geriye tarihli
işlemlerde rebuild maliyeti ve başka maliyet yöntemlerinin ilk sürümde desteklenmemesidir.

Moving Weighted Average Cost vergi, aracı kurum mutabakatı veya yasal muhasebe yöntemi olarak
sunulmaz. Short selling ilk kapsamın dışındadır; satış mevcut projected miktarı aşamaz.

## Değerlendirilen alternatifler

FIFO, specific identification ve posted satırları yerinde güncelleme değerlendirilmiştir. İlk iki
yöntem ürünün ilk analitik kapsamı için daha fazla lot takibi gerektirir. Yerinde güncelleme ise
replay ve audit gereksinimleriyle çeliştiği için reddedilmiştir.
