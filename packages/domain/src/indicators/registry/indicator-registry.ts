import type {
  IndicatorCategory,
  IndicatorDefinition,
  IndicatorInput,
  IndicatorInputField,
  IndicatorOutput,
  IndicatorOutputSpecification,
  WarmupRequirement,
} from '../contracts.js';
import {
  momentumDefinition,
  rocDefinition,
  rsiDefinition,
} from '../definitions/momentum.js';
import {
  emaDefinition,
  smaDefinition,
  wmaDefinition,
} from '../definitions/moving-averages.js';
import {
  cciDefinition,
  stochasticDefinition,
  stochasticRsiDefinition,
  williamsRDefinition,
} from '../definitions/set-b-oscillators.js';
import {
  bollingerBandsDefinition,
  donchianChannelDefinition,
  keltnerChannelDefinition,
  macdDefinition,
} from '../definitions/set-b-trend.js';
import { cmfDefinition, mfiDefinition } from '../definitions/set-b-volume.js';
import { atrDefinition } from '../definitions/volatility.js';
import {
  obvDefinition,
  relativeVolumeDefinition,
  volumeSmaDefinition,
} from '../definitions/volume.js';
import { IndicatorDomainError } from '../errors.js';

export interface IndicatorCatalogEntry {
  readonly code: string;
  readonly version: number;
  readonly displayName: string;
  readonly category: IndicatorCategory;
  readonly requiredInputFields: readonly IndicatorInputField[];
  readonly parameterMetadata: Readonly<Record<string, unknown>>;
  readonly outputMetadata: Readonly<Record<string, unknown>>;
  readonly outputSpecification: IndicatorOutputSpecification;
  readonly documentationReference: string;
}

export interface ResolvedIndicatorDefinition {
  readonly catalog: IndicatorCatalogEntry;
  parseParameters(value: unknown): unknown;
  getWarmup(parameters: unknown): WarmupRequirement;
  calculate(input: IndicatorInput, parameters: unknown): IndicatorOutput;
  parseOutput(value: unknown): IndicatorOutput;
}

export class DuplicateIndicatorDefinitionError extends Error {
  override readonly name = 'DuplicateIndicatorDefinitionError';

  constructor(readonly identifier: string) {
    super(`Indicator definition is already registered: ${identifier}`);
  }
}

export class IndicatorRegistry {
  private readonly entries = new Map<string, ResolvedIndicatorDefinition>();
  private readonly codes = new Set<string>();

  register<P, O extends IndicatorOutput>(
    definition: IndicatorDefinition<P, O>,
  ): this {
    const identifier = registryKey(definition.code, definition.version);
    if (this.entries.has(identifier)) {
      throw new DuplicateIndicatorDefinitionError(identifier);
    }

    const catalog: IndicatorCatalogEntry = {
      code: definition.code,
      version: definition.version,
      displayName: definition.displayName,
      category: definition.category,
      requiredInputFields: [...definition.requiredInputFields],
      parameterMetadata: definition.parameterSchema.metadata,
      outputMetadata: definition.outputSchema.metadata,
      outputSpecification: definition.outputSpecification,
      documentationReference: definition.documentationReference,
    };
    this.entries.set(identifier, {
      catalog,
      parseParameters: (value) => definition.parameterSchema.parse(value),
      getWarmup: (parameters) => definition.getWarmup(parameters as P),
      calculate: (input, parameters) =>
        definition.calculate(input, parameters as P),
      parseOutput: (value) => definition.outputSchema.parse(value),
    });
    this.codes.add(definition.code);
    return this;
  }

  resolve(code: string, version: number): ResolvedIndicatorDefinition {
    const entry = this.entries.get(registryKey(code, version));
    if (entry !== undefined) return entry;
    throw new IndicatorDomainError(
      this.codes.has(code)
        ? 'INDICATOR_VERSION_NOT_FOUND'
        : 'INDICATOR_NOT_FOUND',
    );
  }

  catalog(): readonly IndicatorCatalogEntry[] {
    return [...this.entries.values()]
      .map(({ catalog }) => catalog)
      .sort((left, right) =>
        left.code === right.code
          ? left.version - right.version
          : left.code.localeCompare(right.code),
      );
  }
}

export function createCoreIndicatorRegistry(): IndicatorRegistry {
  return new IndicatorRegistry()
    .register(smaDefinition)
    .register(emaDefinition)
    .register(wmaDefinition)
    .register(rocDefinition)
    .register(momentumDefinition)
    .register(atrDefinition)
    .register(rsiDefinition)
    .register(obvDefinition)
    .register(volumeSmaDefinition)
    .register(relativeVolumeDefinition)
    .register(macdDefinition)
    .register(bollingerBandsDefinition)
    .register(donchianChannelDefinition)
    .register(stochasticDefinition)
    .register(stochasticRsiDefinition)
    .register(cciDefinition)
    .register(williamsRDefinition)
    .register(cmfDefinition)
    .register(mfiDefinition)
    .register(keltnerChannelDefinition);
}

function registryKey(code: string, version: number): string {
  return `${code}@${version}`;
}
