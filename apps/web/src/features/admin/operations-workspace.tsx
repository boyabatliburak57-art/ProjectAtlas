'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { AtlasShell, WorkspaceState } from '../portfolio/atlas-shell';
import { adminOperationsApi, type AdminFlag } from './api';

const killSwitchKeys = new Set([
  'scanner.new-runs.disabled',
  'alerts.evaluation.disabled',
  'notifications.email-delivery.disabled',
  'portfolios.imports.disabled',
  'backtests.creation.disabled',
  'experiments.creation.disabled',
  'exports.disabled',
  'fundamentals.refresh.disabled',
  'patterns.refresh.disabled',
]);

export function OperationsWorkspace() {
  const queryClient = useQueryClient();
  const overview = useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: adminOperationsApi.overview,
    retry: false,
  });
  const flags = useQuery({
    queryKey: ['admin', 'flags'],
    queryFn: adminOperationsApi.flags,
    retry: false,
  });
  const [reason, setReason] = useState('Controlled incident mitigation');
  const [confirmation, setConfirmation] = useState('');
  const [bannerMessage, setBannerMessage] = useState('');
  const [bannerConfirmation, setBannerConfirmation] = useState('');
  const mutation = useMutation({
    mutationFn: async ({
      flag,
      enabled,
    }: {
      flag: AdminFlag;
      enabled: boolean;
    }) => {
      const history = await adminOperationsApi.history(flag.key);
      const latest = history.versions[0];
      return adminOperationsApi.setSwitch(flag.key, enabled, {
        confirmation,
        expectedVersion: latest?.version ?? 0,
        reason,
      });
    },
    onSuccess: async () => {
      setConfirmation('');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });
  const bannerMutation = useMutation({
    mutationFn: async () => {
      const history = await adminOperationsApi
        .history('maintenance.banner')
        .catch(() => null);
      return adminOperationsApi.setMaintenanceBanner({
        confirmation: bannerConfirmation,
        expectedVersion: history?.versions[0]?.version ?? 0,
        message: bannerMessage,
        reason,
      });
    },
    onSuccess: async () => {
      setBannerConfirmation('');
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  return (
    <AtlasShell>
      <main className="admin-operations" id="main-content">
        <header className="admin-heading">
          <p className="admin-kicker">OPERATIONS CONTROL</p>
          <h1>Platform durumu ve güvenli müdahale.</h1>
          <p>
            Yalnız allowlist içindeki operasyonlar çalışır. Her değişiklik
            neden, sürüm ve aktör bilgisiyle audit kaydı üretir.
          </p>
        </header>

        {(overview.isLoading || flags.isLoading) && (
          <WorkspaceState kind="loading">
            Operasyon durumu yükleniyor.
          </WorkspaceState>
        )}
        {(overview.isError || flags.isError) && (
          <WorkspaceState kind="error">
            Admin yetkisi gerekli veya operasyon servisi kullanılamıyor.
          </WorkspaceState>
        )}

        {overview.data && flags.data && (
          <>
            <section
              aria-labelledby="platform-health"
              className="admin-section"
            >
              <h2 id="platform-health">Platform health</h2>
              <div className="admin-metric-grid">
                <Metric
                  label="Queue"
                  value={String(overview.data.queues.length)}
                />
                <Metric
                  label="Paused"
                  value={String(
                    overview.data.queues.filter((queue) => queue.paused).length,
                  )}
                />
                <Metric
                  label="Releases"
                  value={String(overview.data.releases.length)}
                />
                <Metric
                  label="Incidents"
                  value={String(overview.data.incidents.length)}
                />
              </div>
            </section>

            <section aria-labelledby="queues" className="admin-section">
              <h2 id="queues">Queue status</h2>
              <div
                className="admin-table"
                role="table"
                aria-label="Queue status"
              >
                {overview.data.queues.map((queue) => (
                  <div className="admin-row" role="row" key={queue.name}>
                    <strong role="cell">{queue.name}</strong>
                    <span role="cell">
                      {queue.paused ? 'Paused' : 'Running'}
                    </span>
                    <span role="cell">Waiting {queue.counts.waiting ?? 0}</span>
                    <span role="cell">Failed {queue.counts.failed ?? 0}</span>
                  </div>
                ))}
              </div>
            </section>

            <section aria-labelledby="kill-switches" className="admin-section">
              <h2 id="kill-switches">Feature flags ve kill switches</h2>
              <div className="admin-confirmation">
                <label>
                  Reason
                  <input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <label>
                  Confirmation
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder="ENABLE_KILL_SWITCH"
                  />
                </label>
              </div>
              <div
                className="admin-table"
                role="table"
                aria-label="Kill switches"
              >
                {flags.data.items.map((flag) => (
                  <div
                    className="admin-row admin-flag-row"
                    role="row"
                    key={flag.key}
                  >
                    <span role="cell">
                      <strong>{flag.key}</strong>
                      <small>
                        {flag.flagType} / {flag.owner ?? 'Unowned'}
                      </small>
                    </span>
                    {killSwitchKeys.has(flag.key) ? (
                      <>
                        <button
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({ flag, enabled: true })
                          }
                          type="button"
                        >
                          Enable
                        </button>
                        <button
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({ flag, enabled: false })
                          }
                          type="button"
                        >
                          Disable
                        </button>
                      </>
                    ) : (
                      <span role="cell">Versioned flag</span>
                    )}
                  </div>
                ))}
              </div>
              {flags.data.expired.length > 0 && (
                <p className="admin-warning" role="alert">
                  {flags.data.expired.length} expired flag requires review.
                </p>
              )}
              {mutation.isError && (
                <p className="admin-warning" role="alert">
                  Operational change rejected.
                </p>
              )}
            </section>

            <section
              aria-labelledby="recovery"
              className="admin-section admin-summary-grid"
            >
              <div>
                <h2 id="recovery">Recovery drill status</h2>
                <p>{overview.data.recovery.length} drill record visible.</p>
              </div>
              <div>
                <h2>Data freshness</h2>
                <p>
                  Closed bar{' '}
                  {overview.data.dataFreshness?.latest_closed_bar_at ??
                    'notEvaluable'}
                  . Provider payloads remain hidden.
                </p>
              </div>
              <div>
                <h2>Maintenance banner</h2>
                <label>
                  Message
                  <input
                    value={bannerMessage}
                    onChange={(event) => setBannerMessage(event.target.value)}
                  />
                </label>
                <label>
                  Confirmation
                  <input
                    value={bannerConfirmation}
                    onChange={(event) =>
                      setBannerConfirmation(event.target.value)
                    }
                    placeholder="SET_MAINTENANCE_BANNER"
                  />
                </label>
                <button
                  disabled={bannerMutation.isPending || !bannerMessage}
                  onClick={() => bannerMutation.mutate()}
                  type="button"
                >
                  Publish banner
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </AtlasShell>
  );
}

function Metric({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="admin-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
