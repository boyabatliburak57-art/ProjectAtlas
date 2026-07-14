# TASK-030C — Custom Scan AST Request Round-Trip E2E

**Durum:** Hazır  
**Bağımlılık:** TASK-030B

## Amaç

UI'da oluşturulan özel taramanın gerçek HTTP request payload'ına doğru serialize edildiğini ve backend round-trip'ında semantiğini koruduğunu doğrulamak.

## Ana senaryo

Kullanıcı:

1. Aktif BIST universe seçer.
2. Root `AND` group kullanır.
3. RSI(14), `1d`, `LT`, `35` koşulu ekler.
4. EMA(20), `1d`, `CROSSES_ABOVE`, EMA(50), `1d` koşulu ekler.
5. Taramayı çalıştırır.

## Doğrulanacaklar

- Request rule version
- Universe filter
- Root AND
- Child sayısı
- nodeId politikası
- RSI code/version/period/timeframe
- LT ve 35 constant
- EMA 20/50 operandları
- CROSSES_ABOVE
- Backend normalized AST
- Semantik eşdeğerlik
- Run rule/plan version
- UI result run id

## İlkeler

- Browser request'i gözlemlenir.
- Request gerçek backend'e gönderilir.
- API validation bypass edilmez.
- Dış provider fake olabilir.
- Test yalnız UI snapshot'ına dayanmaz.
- Koşul tabanlı bekleme kullanılır.

## Kabul kriterleri

- Request payload tam gözlemleniyor
- Expected AST alanları doğrulanıyor
- Normalized AST semantik olarak eşdeğer
- Run doğru version ilişkisi taşıyor
- Sonuç ekranı aynı run id'yi kullanıyor
- Mevcut Playwright testleri regresyonsuz geçiyor

## T3 Code prompt

```text
TASK-030C görevini uygula.

DOC-015, DOC-013, API-004 ve milestone audit D-002 bulgusunu oku.

Playwright ile UI üzerinden şu custom scan'i oluştur:
- active BIST universe
- root AND
- RSI(14) 1d LT 35
- EMA(20) 1d CROSSES_ABOVE EMA(50) 1d

Gerçek POST scanner run request payload'ını browser network katmanından gözlemle.
AST alanlarını doğrula.
Backend validation/normalization sonucunun semantik eşdeğerliğini doğrula.
Run rule/plan version ilişkisini ve sonuç ekranındaki run id'yi doğrula.

API validation'ı bypass etme.
Testi yalnız UI snapshot'ıyla geçirme.
```
