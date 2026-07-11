# Web

Project Atlas Next.js web istemcisi.

## Yerel geliştirme

Repository kökündeki `.env.example` dosyasını `.env` olarak kopyalayın veya
`NEXT_PUBLIC_API_URL` değişkenini shell üzerinden sağlayın. `NEXT_PUBLIC_*` değişkenlerine
secret yazmayın.

```bash
pnpm --filter web dev
```

Varsayılan adres `http://localhost:3000`, durum sayfası `/health` yolundadır.

## Kontroller

```bash
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web build
```

Bu scaffold ürün dashboard'u, authentication veya piyasa verisi iş mantığı içermez.
