# T3 Code Başlangıç Noktası

## İlk oturum mesajı

```text
Bu repository Project Atlas uygulamasına aittir.

Kod üretmeden önce sırasıyla şu dosyaları oku:
1. README.md
2. ATLAS_INDEX.md
3. SYSTEM_PROMPT.md
4. docs/DOC-000-Project-Constitution.md
5. docs/DOC-001-Business-Requirements.md
6. docs/DOC-002-Product-Requirements.md
7. docs/DOC-003-Software-Requirements.md
8. architecture/ARCH-001-System-Overview.md
9. database/DB-001-Conceptual-Model.md
10. api/API-001-Overview.md

Sonra projenin amacını, ilk sürüm kapsamını, kapsam dışı özellikleri ve mimari sınırları özetle. Henüz kod üretme. Okuyamadığın dosya varsa tam yolunu belirt.
```

## Görev mesajı

```text
tasks/TASK-001-Repository-Validation.md görevini uygula. Önce gereksinimleri özetle, etkilenecek dosyaları listele ve dokümanlarla çelişki varsa kod üretmeden bildir. Çelişki yoksa görevi tamamla, testleri çalıştır ve ilgili dokümanları güncelle.
```

## Oturum sonu

```text
Bu oturumda yapılan değişiklikleri, çalıştırılan testleri, kalan riskleri ve önerilen sonraki görevi özetle. Değişen dosyaları tam yollarıyla listele.
```

## v0.2 görev okuma mesajı

```text
Önce ATLAS_INDEX.md ve SYSTEM_PROMPT.md dosyalarını oku.

Ardından uygulayacağın görev kartında belirtilen DOC, ARCH, ADR, DB ve API belgelerini oku.
Tüm repository'yi gereksiz yere taramak yerine ilgili belgeleri eksiksiz oku.

Kod yazmadan önce:
1. Gereksinimleri özetle.
2. Etkilenecek modülleri ve dosyaları listele.
3. Güvenlik ve migration etkisini belirt.
4. Doküman çelişkisi varsa dur.
5. Çelişki yoksa uygulama planını ver.
```

## v0.3 başlangıç mesajı

```text
Önce ATLAS_INDEX.md, SYSTEM_PROMPT.md, DOC-008, DOC-009, ARCH-003, ARCH-004, ADR-004, ADR-005, DB-003 ve API-003 dosyalarını oku. Henüz kod üretme. Indicator/Scanner sınırını, warm-up ve versioning politikasını, üç durumlu değerlendirmeyi ve TASK-011 geçiş kapısını özetle.
```

## v0.3.1 remediation başlangıç mesajı

```text
Foundation audit sonucu NO-GO olarak raporlandı.

Önce şu dosyaları oku:
- reports/foundation-milestone-audit.md
- reports/REMEDIATION_PLAN-v0.3.1.md
- docs/DOC-010-Quality-Gates-and-Toolchain-Policy.md
- architecture/ADR_INDEX.md

TASK-012 veya sonraki Indicator Engine görevlerine başlama.

Sırasıyla TASK-011A, 011B, 011C, 011D, 011E ve 011F uygulanacak.
Her görevden önce ilgili kabul kriterlerini özetle.
```

## v0.4 başlangıç mesajı

```text
Project Atlas v0.4 belgelerini oku: DOC-011, DOC-012, DOC-013, ARCH-005, ADR-006, ADR-007, DB-004, API-004 ve SCANNER_RUNTIME_TEST_MATRIX. Henüz kod üretme. ScanRun state machine, idempotency, batching, progress fallback, immutable revisions ve TASK-021/TASK-030 geçiş kapılarını özetle.
```

## v0.4.1 remediation başlangıç mesajı

```text
Indicator/Scanner Core milestone audit sonucu NO-GO olarak raporlandı.

Başarısız kapılar:
- pnpm validate:adr: duplicate ADR-006
- pnpm format:check: dokuz Markdown dosyası

Önce remediation planını, DOC-014'ü, ADR_INDEX'i ve milestone audit raporunu oku.
TASK-022'ye başlama.
Sırasıyla TASK-021A, TASK-021B ve TASK-021C uygulanacak.
```

## v0.4.2 remediation başlangıç mesajı

```text
Scanner Runtime milestone audit sonucu NO-GO olarak raporlandı.

Başarılı alanlar:
- runtime 206/206
- PostgreSQL/Redis integration 24/24
- Playwright hazır/özel tarama 2/2
- IDOR, duplicate, retry, cancellation, progress
- secret scan, dependency audit
- lint, typecheck, production build

Açık bulgular:
- F-001: pnpm format:check sekiz scanner dosyasında başarısız
- D-001: performance baseline ve threshold yok
- D-002: custom scan AST request payload round-trip doğrulanmıyor

Önce:
- reports/REMEDIATION_PLAN-v0.4.2.md
- docs/DOC-015-Scanner-Performance-and-E2E-Quality-Gates.md
- guides/SCANNER_PERFORMANCE_BASELINE_GUIDE.md
- Scanner Runtime milestone audit raporu

dosyalarını oku.

Sonraki pakete geçme.
Sırasıyla TASK-030A, TASK-030B, TASK-030C ve TASK-030D uygulanacak.
```
