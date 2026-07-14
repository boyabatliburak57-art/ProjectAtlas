export interface DurationSummary {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export function summarizeDurations(values: readonly number[]): DurationSummary {
  if (values.length === 0) return { p50Ms: 0, p95Ms: 0, maxMs: 0 };
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: round(sorted.at(-1) ?? 0),
  };
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return round(sorted[index] ?? 0);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
