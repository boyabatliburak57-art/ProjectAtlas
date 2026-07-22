import { publicEnvironment } from '@/config/env';

const base = publicEnvironment.NEXT_PUBLIC_API_URL;

export interface AdminFlag {
  readonly id: string;
  readonly key: string;
  readonly description: string;
  readonly flagType: string;
  readonly owner: string | null;
  readonly expiresAt: string | null;
}

export interface AdminOverview {
  readonly backup: Record<string, unknown> | null;
  readonly dataFreshness?: {
    readonly latest_closed_bar_at: string | null;
    readonly latest_financial_at: string | null;
    readonly latest_pattern_at: string | null;
  };
  readonly incidents: readonly Record<string, unknown>[];
  readonly queues: readonly {
    readonly name: string;
    readonly paused: boolean;
    readonly counts: Readonly<Record<string, number>>;
  }[];
  readonly recovery: readonly Record<string, unknown>[];
  readonly releases: readonly Record<string, unknown>[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    credentials: 'include',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string };
  } | null;
  if (!response.ok)
    throw new Error(body?.error?.code ?? `ADMIN_HTTP_${response.status}`);
  return body?.data as T;
}

export const adminOperationsApi = {
  overview: () => request<AdminOverview>('/admin/operations/overview'),
  flags: () =>
    request<{ expired: AdminFlag[]; items: AdminFlag[] }>(
      '/admin/feature-flags',
    ),
  history: (key: string) =>
    request<{
      flag: AdminFlag;
      versions: readonly {
        enabled: boolean;
        environment: string;
        version: number;
      }[];
    }>(`/admin/feature-flags/${encodeURIComponent(key)}/history`),
  setSwitch: (
    key: string,
    enabled: boolean,
    input: { reason: string; expectedVersion: number; confirmation: string },
  ) =>
    request(
      `/admin/maintenance/kill-switches/${encodeURIComponent(key)}/${enabled ? 'enable' : 'disable'}`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      },
    ),
  setMaintenanceBanner: (input: {
    confirmation: string;
    expectedVersion: number;
    message: string;
    reason: string;
  }) =>
    request('/admin/maintenance/banner', {
      body: JSON.stringify(input),
      method: 'POST',
    }),
};
