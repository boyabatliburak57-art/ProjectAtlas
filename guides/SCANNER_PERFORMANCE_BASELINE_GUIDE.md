# Scanner Performance Baseline Guide

## Önerilen yapı

```text
performance/
├── fixtures/
│   ├── bist-small/
│   ├── bist-full/
│   └── scanner-medium/
├── scenarios/
├── thresholds/
└── README.md

reports/performance/
├── scanner-runtime-baseline.json
└── scanner-runtime-baseline.md
```

## Benchmark runner özellikleri

- sabit scenario id
- warm-up run
- ölçüm run'ları
- p50/p95/max
- başarı/hata sayısı
- threshold evaluation
- JSON output
- Markdown summary
- threshold failure durumunda non-zero exit

## Fixture

Fixture:

- deterministik,
- dış API gerektirmeyen,
- source controlled veya sabit seed ile üretilen,
- geçerli ve edge-case barlar içeren

bir veri seti olmalıdır.

## Komut örneği

```bash
pnpm perf:scanner
pnpm perf:scanner --scenario small-sync
pnpm perf:scanner --scenario full-bist
```

## Rapor

- environment
- scenario
- threshold
- p50
- p95
- max
- pass/fail
- processed/matched count
- error count
- notes

## CI stratejisi

Her PR:

- small sync
- pagination
- idempotent replay

Main/nightly/manual:

- full BIST
- medium complexity

Milestone audit'te tüm zorunlu senaryolar çalıştırılır.
