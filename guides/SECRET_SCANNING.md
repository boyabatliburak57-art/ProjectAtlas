# Secret Scanning

Project Atlas, Gitleaks `v8.30.1` kullanır. Sürüm ve resmî release archive SHA-256 değerleri
`scripts/install-gitleaks.sh` içinde sabittir. Binary repository'ye yazılmaz; kullanıcı cache
dizinine indirilir. İndirme, checksum veya version kontrolü başarısızsa scan başlamadan hata
verir.

## Local kullanım

Çalışma ağacı ve Git geçmişi:

```bash
pnpm secret:scan
```

Synthetic detection kontrolü:

```bash
pnpm secret:scan:test
```

Synthetic test gerçek credential içermez. Test değeri runtime'da deterministik olarak üretilir,
scanner finding içeriği stdout/stderr'e aktarılmaz ve geçici dizin test sonunda silinir.

## CI

`.github/workflows/secret-scan.yml` şu eventlerde çalışır:

- pull request,
- `main` branch push,
- manual `workflow_dispatch`.

Checkout full history kullanır. Workflow synthetic detection testini, ardından çalışma ağacı ve
Git geçmişi scan'ini çalıştırır. Scanner indirilemez, checksum doğrulanamaz, executable çalışmaz
veya scan tamamlanamazsa job non-zero sonuçlanır.

## Suppression politikası

Finding fingerprint suppression'ları yalnızca repository kökündeki `.gitleaksignore` dosyasında
tutulur. Yeni fingerprint:

1. gerçek secret olmadığı manuel olarak doğrulandıktan sonra,
2. pull request içinde gerekçesi yazılarak,
3. mümkün olan en dar fingerprint kullanılarak

eklenebilir. Secret değeri suppression dosyasına, commit mesajına, issue'ya veya test çıktısına
yazılmaz. Geniş path/rule allowlist'i varsayılan çözüm değildir.

Gerçek secret bulunursa önce credential iptal/rotate edilir; yalnızca dosyadan silmek yeterli
değildir. Git geçmişi etkisi ayrıca değerlendirilir.

### Generated path istisnası

`.gitleaks.toml`, yalnızca Git tarafından ignore edilen ve Next.js tarafından yeniden üretilen
`apps/web/.next/` build artifact'larını path allowlist ile dışarıda bırakır. Audit sırasında bu
dosyalardaki framework-generated manifest/cache değerleri finding üretmiştir. `apps/web/src/`,
Markdown veya başka bir source/config yolu bu istisnaya dahil değildir. Yeni bir path allowlist
eklemek ayrı güvenlik incelemesi ve açık gerekçe gerektirir.
