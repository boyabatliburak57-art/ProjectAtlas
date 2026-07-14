# DOC-017 — Watchlist Requirements

**Sürüm:** 1.0  
**Durum:** Uygulamaya hazır

## 1. Amaç

Kullanıcının BIST hisselerini birden fazla özel listede izlemesini; not, etiket, tarama evreni ve alarm kaynağı olarak kullanmasını sağlar.

## 2. Özellikler

- birden fazla watchlist
- ad/açıklama
- sembol ekleme/kaldırma
- manuel sıralama
- not ve etiket
- piyasa özeti
- watchlist universe ile tarama
- toplu alarm oluşturma
- soft delete/restore

## 3. Kurallar

- Aynı instrument aynı listede yalnız bir kez bulunur.
- Visibility ilk sürümde private'dır.
- Aynı isimde liste oluşturulabilir.
- Note plain text veya güvenli sanitize edilmiş formattadır.
- Kota backend'de uygulanır.

## 4. Watchlist universe

Scanner isteği:

```json
{
  "type": "watchlist",
  "watchlistId": "uuid"
}
```

Run başında instrument snapshot alınır. Liste sonradan değişse bile mevcut run değişmez.

## 5. Piyasa özeti

- symbol
- company
- last price
- daily change
- volume
- relative volume
- data time
- stale status
- active alert count

## 6. Silme etkisi

Silinen watchlist yeni run evreni olamaz. Bağlı aktif alarmlar policy gereği paused/invalid olarak işaretlenir.

## 7. Güvenlik

- ownership/IDOR
- note XSS
- toplu işlem limiti
- başka kullanıcı watchlist'inin scanner universe olarak reddi

## 8. Kabul kriterleri

- Duplicate instrument engellenir.
- Reorder deterministiktir.
- Note güvenlidir.
- Universe snapshot testlidir.
- Kota ve ownership backend'dedir.
- Soft delete bağlı alarm davranışı testlidir.
