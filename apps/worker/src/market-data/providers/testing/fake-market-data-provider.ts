import type {
  FetchBarsRequest,
  RawMarketDataProviderAdapter,
} from '../contracts';

export interface FakeMarketDataProviderOptions {
  readonly code?: string;
  readonly capabilities: unknown;
  readonly instruments: unknown;
  readonly barBatch: unknown;
}

export class FakeMarketDataProviderAdapter implements RawMarketDataProviderAdapter {
  readonly code: string;
  readonly fetchRequests: FetchBarsRequest[] = [];

  constructor(private readonly options: FakeMarketDataProviderOptions) {
    this.code = options.code ?? 'fake-provider';
  }

  getCapabilities(): unknown {
    return this.options.capabilities;
  }

  listInstruments(): Promise<unknown> {
    return Promise.resolve(this.options.instruments);
  }

  fetchBars(request: FetchBarsRequest): Promise<unknown> {
    this.fetchRequests.push(request);
    return Promise.resolve(this.options.barBatch);
  }
}
