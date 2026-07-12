# TASK-011D — Node Version Enforcement

**Durum:** Tamamlandı
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

## Tamamlanma notu

- **Tarih:** 2026-07-12
- **Durum:** Tamamlandı
- **Toolchain:** Node 22.14.0, pnpm 9.15.4 ve Corepack 0.31.0 doğrulandı.
- **Enforcement:** `.nvmrc`, `.node-version`, package engines/packageManager, preinstall checker,
  `.npmrc` engine-strict ve CI setup-node aynı hedefe bağlandı.
- **Negatif test:** Node 25.8.1 version checker tarafından exit 1 ile reddedildi; yanlış major
  fixture testi geçti.
- **Kalite:** Format, cache dışı lint/typecheck/test/build, database/worker integration,
  OpenAPI, ADR, secret scan ve dependency audit Node 22.14.0 altında geçti.
- **Sonraki görev:** TASK-011E
