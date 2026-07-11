import { z } from 'zod';

import type {
  FetchBarsRequest,
  MarketDataProvider,
  ProviderBarBatch,
  ProviderCapabilities,
  ProviderInstrumentDto,
  RawMarketDataProviderAdapter,
} from './contracts';
import { ProviderError } from './errors';
import {
  fetchBarsRequestSchema,
  parseProviderCode,
  providerBarBatchSchema,
  providerCapabilitiesSchema,
  providerInstrumentListSchema,
} from './schemas';

export class ValidatedMarketDataProvider implements MarketDataProvider {
  readonly code: string;

  constructor(private readonly adapter: RawMarketDataProviderAdapter) {
    this.code = parseProviderCode(adapter.code);
  }

  getCapabilities(): ProviderCapabilities {
    return this.parseExternalResponseSync(
      () => this.adapter.getCapabilities(),
      providerCapabilitiesSchema,
    );
  }

  async listInstruments(): Promise<readonly ProviderInstrumentDto[]> {
    return this.parseExternalResponseAsync(
      () => this.adapter.listInstruments(),
      providerInstrumentListSchema,
    );
  }

  async fetchBars(request: FetchBarsRequest): Promise<ProviderBarBatch> {
    const parsedRequest = fetchBarsRequestSchema.parse(request);
    const capabilities = this.getCapabilities();

    if (!capabilities.supportedTimeframes.includes(parsedRequest.timeframe)) {
      throw new ProviderError('PROVIDER_UNSUPPORTED_TIMEFRAME');
    }

    return this.parseExternalResponseAsync(
      () => this.adapter.fetchBars(parsedRequest),
      providerBarBatchSchema,
    );
  }

  private parseExternalResponseSync<Output>(
    operation: () => unknown,
    schema: z.ZodType<Output>,
  ): Output {
    try {
      return schema.parse(operation());
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  private async parseExternalResponseAsync<Output>(
    operation: () => Promise<unknown>,
    schema: z.ZodType<Output>,
  ): Promise<Output> {
    try {
      return schema.parse(await operation());
    } catch (error: unknown) {
      throw this.normalizeError(error);
    }
  }

  private normalizeError(error: unknown): ProviderError {
    if (error instanceof ProviderError) {
      return error;
    }

    if (error instanceof z.ZodError) {
      return new ProviderError('PROVIDER_MALFORMED_RESPONSE', {
        cause: error,
      });
    }

    return new ProviderError('PROVIDER_UNAVAILABLE', { cause: error });
  }
}
