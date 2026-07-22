# Deployment and Platform Adapter

Project Atlas'ın provider-neutral artifact'leri tek `Dockerfile` içindeki `web`, `api`, `worker` ve
`migration` target'larıdır. İlk orchestration adapter'ı Kubernetes/Kustomize'dır; belirli bir cloud
sağlayıcısı zorunlu değildir.

## Platform adapter sorumlulukları

Platform adapter aşağıdaki dış kaynakları uygulama manifestini değiştirmeden sağlamalıdır:

- private, TLS zorunlu managed PostgreSQL ve `DATABASE_URL`,
- private/TLS Redis ve `REDIS_URL`,
- encrypted/versioned object storage endpoint, bucket ve scoped access credential,
- `atlas-runtime-secrets` secret-manager senkronizasyonu,
- internal metrics scrape için en az 32 karakterli `METRICS_BEARER_TOKEN`,
- TLS certificate, edge/WAF/request limit ve ingress class,
- DNS egress ile managed-service security group/network policy kuralları,
- immutable registry digest, workload identity ve image-pull policy,
- external queue-lag autoscaling adapter'ı.

Repository secret değeri veya cloud-specific credential içermez. Kubernetes Secret manifesti
bilerek oluşturulmaz; `atlas-runtime-secrets` deployment öncesinde platform secret-manager adapter'ı
tarafından provision edilmelidir. PostgreSQL, Redis ve object storage container içinde çalışmaz ve
container filesystem'i kalıcı state sayılmaz. Yalnız bounded `/tmp` `emptyDir` kullanılır.

## Process rolleri

| Workload                 | Image target | Composition root / role              | Scaling                          |
| ------------------------ | ------------ | ------------------------------------ | -------------------------------- |
| Web                      | `web`        | Next standalone `apps/web/server.js` | CPU/request                      |
| API                      | `api`        | Nest `apps/api/dist/main.js`         | CPU, p95, error rate             |
| Market data              | `worker`     | `WORKER_ROLE=market-data`            | queue lag                        |
| Scanner                  | `worker`     | `WORKER_ROLE=scanner`                | queue lag                        |
| Alert                    | `worker`     | `WORKER_ROLE=alert`                  | queue lag                        |
| Notification             | `worker`     | `WORKER_ROLE=notification`           | queue lag                        |
| Backtest                 | `worker`     | `WORKER_ROLE=backtest`               | ayrı CPU/memory pool + queue lag |
| Experiment               | `worker`     | `WORKER_ROLE=experiment`             | queue lag/combination budget     |
| Scheduled/reconciliation | `worker`     | `WORKER_ROLE=scheduled`              | singleton/recreate               |
| Migration                | `migration`  | compiled database migration CLI      | one-shot, suspended template     |

`WORKER_ROLE=all` yalnız local/integration kullanımını geriye uyumlu tutar. Dedicated production
deployment başka role ait BullMQ queue'sunu consume etmez.

## Release rendering

Base manifestlerdeki sıfır digest güvenli, deploy edilemez placeholder'dır. Release workflow her
image'ı ayrı immutable `sha256:` digest ile değiştirir ve placeholder kalırsa gate fail olur.
Production overlay yalnız GitHub `production` environment approval'ından sonra uygulanabilir.

## Health ve shutdown

- API `/health/live` yalnız process liveness;
- API `/health/startup` bootstrap tamamlanması;
- API `/health/ready` traffic acceptance ve production'da PostgreSQL ping;
- worker startup/readiness `/tmp/atlas-worker-ready`, liveness PID 1 kontrolü;
- API SIGTERM'de readiness'i kapatır ve Nest request drain uygular;
- worker SIGTERM'de yeni BullMQ job alımını pause eder, active job'u tamamlar/safe retry için kapatır.

Health response hostname, connection string, secret veya raw dependency ayrıntısı dönmez.

## Migration ve rollback

Migration job application startup'ından ayrıdır. `PGOPTIONS` lock timeout 5 saniye ve statement
timeout 120 saniye uygular. `deploy/migrations/policy.yaml`, ADR-025 expand/contract ve N/N−1
compatibility sözleşmesidir. Contract/destructive migration ayrı release, restore-drill referansı ve
forward-fix planı olmadan ilerlemez.

Rollback yalnız önceki immutable digest'e yapılır. Additive expand schema yerinde kalabilir;
destructive contract sonrasında otomatik down migration güvenli varsayılmaz. `rollback-rehearsal.mjs`
yalnız `none` veya `expand` phase için image rollback kanıtı üretir.

## Source map ve debug

Production container'ları JavaScript source map dosyalarını içermez; browser production source map
üretimi kapalıdır. `API_DEBUG` ve `WORKER_DEBUG` staging/production'da `false` olmak zorundadır.
Public error response stack trace içermez. Debug gerektiğinde süreli, erişim kontrollü internal
telemetry kullanılır; debug image production rollout artifact'i değildir.

## Observability adapter

`observability/otel-collector.yaml` OpenTelemetry-compatible collector sınırını; `observability/grafana`
dashboard provisioning artifact'lerini ve `observability/alerts` Prometheus/Alertmanager kurallarını
tanımlar. Platform adapter bu dosyaları managed veya self-hosted telemetry backend'ine uygular.
Telemetry endpoint ve credential'ları yalnız secret manager'dan sağlanır; manifestlere yazılmaz.

Telemetry kaybı readiness'i veya kullanıcı işleminin kalıcı sonucunu değiştirmez. API ve worker
best-effort telemetry üretir, PostgreSQL iş state'i authoritative kalır. Metric label allowlist'i
user/resource/symbol/run kimliklerini reddeder. Staging release, dedicated synthetic identity ile
health, session, market, scanner, portfolio ve backtest journey kontrollerini tamamlamadan release
record üretmez.

## Backup ve recovery adapter'ı

`deploy/recovery/capabilities.yaml` managed PostgreSQL backup/PITR, ayrı failure domain, KMS
encryption, 35 günlük retention ve object storage versioning sözleşmesini tanımlar. Platform adapter
bu capability'leri sağlamadan production-ready sayılmaz. Uygulamanın `atlas-runtime-secrets`
credential'ı restore yetkisi taşımaz; yalnız `atlas-recovery` service account'u
`atlas-restore-secrets` ile restore doğrulaması yapabilir.

`recovery.yaml` backup status monitorünü ve bilinçli olarak suspend edilmiş recovery gate/restore
drill şablonlarını içerir. Production workflow migration veya rollout öncesinde kullanıcı tarafından
verilen drill ID'sini PostgreSQL'deki immutable recovery kanıtına karşı doğrular. Provider'a özel
restore, replica ve object lifecycle implementasyonu bu sözleşmenin adapter noktasıdır; manifestler
gerçek production restore veya deploy'u kendiliğinden başlatmaz.
