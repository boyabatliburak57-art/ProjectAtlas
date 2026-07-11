import type {
  MarketDataProvider,
  RawMarketDataProviderAdapter,
} from './contracts';
import { ProviderError } from './errors';
import { parseProviderCode } from './schemas';
import { ValidatedMarketDataProvider } from './validated-provider';

export class ProviderRegistry {
  private readonly providers = new Map<string, MarketDataProvider>();

  register(adapter: RawMarketDataProviderAdapter): MarketDataProvider {
    const provider = new ValidatedMarketDataProvider(adapter);

    if (this.providers.has(provider.code)) {
      throw new Error(`Provider is already registered: ${provider.code}`);
    }

    this.providers.set(provider.code, provider);
    return provider;
  }

  resolve(code: string): MarketDataProvider {
    let normalizedCode: string;
    try {
      normalizedCode = parseProviderCode(code);
    } catch {
      throw new ProviderError('PROVIDER_NOT_REGISTERED');
    }

    const provider = this.providers.get(normalizedCode);
    if (provider === undefined) {
      throw new ProviderError('PROVIDER_NOT_REGISTERED');
    }

    return provider;
  }

  listCodes(): readonly string[] {
    return [...this.providers.keys()].sort();
  }
}
