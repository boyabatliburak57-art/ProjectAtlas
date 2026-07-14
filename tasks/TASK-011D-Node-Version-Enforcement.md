# TASK-011D — Node Version Enforcement

**Durum:** Hazır  
**Bağımlılık:** TASK-011C

## Amaç

Repository hedef Node `22.14.0` sürümünü local, package manager ve CI genelinde tutarlı şekilde uygulamak.

## Kapsam

- `.nvmrc`
- `.node-version`, kullanılıyorsa
- `package.json#engines`
- package manager/corepack ayarı
- CI setup-node
- version check script
- developer documentation
- audit command version output.

## Kabul kriterleri

- tüm sürüm kaynakları `22.14.0` ile uyumlu
- yanlış major Node sürümünde version check başarısız
- CI Node 22.14.0 kullanıyor
- pnpm sürümü sabit veya corepack ile kontrollü
- lint/typecheck/test/build hedef Node sürümünde tekrar çalıştırılmış
- audit raporunda tool versions bulunuyor.

## T3 Code prompt

```text
TASK-011D görevini uygula.

Repository hedefi Node 22.14.0 olacak şekilde .nvmrc, engines, CI ve version check kaynaklarını hizala.
Audit'in Node 25.8.1 ile çalışmış olmasını sapma olarak kapat.
Yanlış major sürümde açık hata üret.
Tüm kalite komutlarını Node 22.14.0 ortamında tekrar çalıştır ve sonuçları raporla.
```
