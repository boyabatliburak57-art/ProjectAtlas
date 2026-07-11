export default function HealthPage() {
  return (
    <main className="health-page">
      <p className="eyebrow">Project Atlas Web</p>
      <h1>Servis çalışıyor</h1>
      <p role="status">
        <span className="status-dot" aria-hidden="true" />
        Healthy
      </p>
    </main>
  );
}
