# TASK-030B — Scanner Performance Baseline

**Durum:** Hazır  
**Bağımlılık:** TASK-030A

## Amaç

Scanner Runtime için tekrarlanabilir ve threshold tabanlı performans baseline'ı oluşturmak.

## Referanslar

- DOC-015
- SCANNER_PERFORMANCE_BASELINE_GUIDE
- DOC-011
- ARCH-005

## Kapsam

- deterministic fixtures
- benchmark runner
- environment metadata
- p50/p95/max
- threshold config
- JSON ve Markdown report
- CI stratejisi
- small sync
- full BIST
- medium complexity
- pagination
- progress polling
- idempotent replay

## Gereksinimler

- Gerçek PostgreSQL ve Redis test altyapısı
- Gerçek scanner worker path
- Dış provider yok
- Deterministik matched count
- Threshold failure non-zero exit
- Warm/cold cache ayrımı
- Worker concurrency ve batch size raporu

## Kabul kriterleri

- Root performans komutu mevcut
- Tüm zorunlu senaryolar çalışıyor
- JSON ve Markdown rapor oluşuyor
- Full BIST fixture 500–650 instrument içeriyor
- Threshold failure komutu başarısız yapıyor
- Duplicate result yok
- Progress monoton
- CI çalıştırma stratejisi belgelenmiş

## T3 Code prompt

```text
TASK-030B görevini uygula.

Önce DOC-015, SCANNER_PERFORMANCE_BASELINE_GUIDE ve milestone audit D-001 bulgusunu oku.

Gerçek scanner worker, test PostgreSQL ve Redis yolunu kullanan deterministic fixture ve benchmark runner oluştur.

Ölç:
- small sync
- full BIST universe
- medium complexity
- result pagination
- progress polling
- idempotent replay

p50, p95, max, error count ve threshold sonucu üret.
JSON ve Markdown rapor oluştur.
Threshold failure non-zero exit üretmeli.

Gerçek provider/internet kullanma.
Mock veya no-op scanner path ile baseline oluşturma.
Threshold'ları yalnız testi geçirmek için yükseltme.
```
