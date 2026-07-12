# TASK-013 — Indicator Math Primitives

**Durum:** Tamamlandı
**Bağımlılık:** TASK-012

## Kapsam

- rolling sum/mean/min/max
- rolling standard deviation
- Wilder smoothing
- EMA seed
- safe division
- true range
- typical price
- null warm-up alignment.

## Kabul kriterleri

- Saf ve deterministic fonksiyonlar.
- Input mutate edilmez.
- NaN/Infinity çıkmaz.
- Population/sample std seçimi açık.
- Seed ve warm-up testli.
- Gereksiz O(n²) algoritma yok.

## T3 Code prompt

```text
TASK-013'ü uygula. DOC-008 ve ARCH-003'e uy. Math primitives için boundary ve seed testleri ekle; registry veya API yazma.
```
