import { publicEnvironment } from '@/config/env';

import type {
  IndicatorDefinition,
  OperatorDefinition,
  PresetSummary,
  ScanResult,
  ScanRule,
  ScanRun,
  ValidationResult,
} from './types';

const base = publicEnvironment.NEXT_PUBLIC_API_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const error = body as { code?: string; message?: string } | null;
    throw new Error(error?.code ?? error?.message ?? `HTTP_${response.status}`);
  }
  return (body as { data: T }).data;
}

export const scannerApi = {
  indicators: async () =>
    (await request<{ items: IndicatorDefinition[] }>('/indicators')).items,
  operators: () => request<OperatorDefinition[]>('/scanner/operators'),
  presets: () => request<PresetSummary[]>('/preset-scans'),
  preset: (code: string) => request<PresetSummary>(`/preset-scans/${code}`),
  validate: (rule: ScanRule) =>
    request<ValidationResult>('/scanner/validate', {
      method: 'POST',
      body: JSON.stringify({ rule, universeInstrumentCount: 100 }),
    }),
  run: (rule: ScanRule, key: string) =>
    request<ScanRun>('/scanner/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: JSON.stringify({ rule }),
    }),
  runPreset: (code: string, key: string) =>
    request<ScanRun>(`/preset-scans/${code}/runs`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: '{}',
    }),
  status: (id: string) => request<ScanRun>(`/scanner/runs/${id}`),
  results: async (id: string, cursor?: string) => {
    const response = await fetch(
      `${base}/scanner/runs/${id}/results?limit=50&includeExplanation=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { headers: { 'Content-Type': 'application/json' } },
    );
    const body = (await response.json()) as {
      data: { items: ScanResult[] };
      meta: { nextCursor?: string | null };
      code?: string;
    };
    if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
    return { items: body.data.items, nextCursor: body.meta.nextCursor ?? null };
  },
  cancel: (id: string) =>
    request<ScanRun>(`/scanner/runs/${id}/cancel`, {
      method: 'POST',
      body: '{}',
    }),
  save: (input: {
    name: string;
    description: string;
    tags: string[];
    rule: ScanRule;
  }) =>
    request<{ id: string; currentRevision: number }>('/saved-scans', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
