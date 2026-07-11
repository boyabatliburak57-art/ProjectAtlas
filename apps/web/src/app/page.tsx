import Link from 'next/link';

import { publicEnvironment } from '@/config/env';

const workspaceItems = [
  ['Web uygulaması', 'Hazır'],
  ['API bağlantısı', 'Yapılandırıldı'],
  ['Ürün modülleri', 'Sonraki görevler'],
] as const;

export default function HomePage() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link className="brand" href="/" aria-label="Project Atlas ana sayfa">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          <span>Project Atlas</span>
        </Link>
        <nav aria-label="Ana navigasyon">
          <Link className="text-link" href="/health">
            Sistem durumu
          </Link>
        </nav>
      </header>

      <main className="status-workspace">
        <section className="status-intro" aria-labelledby="page-title">
          <p className="eyebrow">Web workspace · v0.2</p>
          <h1 id="page-title">Uygulama iskeleti çalışıyor.</h1>
          <p className="lede">
            Next.js arayüzü hazır. Ürün ekranları ilgili görevlerle, domain
            sınırları korunarak eklenecek.
          </p>
        </section>

        <section className="system-readout" aria-labelledby="readout-title">
          <div className="readout-heading">
            <div>
              <p className="section-index">01 / Başlangıç durumu</p>
              <h2 id="readout-title">Çalışma alanı</h2>
            </div>
            <p className="live-status">
              <span className="status-dot" aria-hidden="true" />
              Web hazır
            </p>
          </div>

          <dl className="status-list">
            {workspaceItems.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>

          <div className="endpoint-row">
            <span>Public API endpoint</span>
            <code>{publicEnvironment.NEXT_PUBLIC_API_URL}</code>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p>Analiz platformu · Yatırım tavsiyesi değildir.</p>
        <p>İstanbul / UTC+3</p>
      </footer>
    </div>
  );
}
