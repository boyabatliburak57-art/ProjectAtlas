import type { ScannerMetrics } from './contracts';

export class InMemoryScannerMetrics implements ScannerMetrics {
  readonly counters = new Map<string, number>();
  readonly observations = new Map<string, number[]>();

  increment(
    name: string,
    value = 1,
    _tags: Readonly<Record<string, string>> = {},
  ): void {
    void _tags;
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  observe(
    name: string,
    value: number,
    _tags: Readonly<Record<string, string>> = {},
  ): void {
    void _tags;
    this.observations.set(name, [
      ...(this.observations.get(name) ?? []),
      value,
    ]);
  }
}
