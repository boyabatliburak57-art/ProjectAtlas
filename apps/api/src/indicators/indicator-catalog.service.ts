import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  IndicatorCatalogEntry,
  IndicatorCategory,
  IndicatorRegistry,
} from '@atlas/domain';

import {
  INDICATOR_CATEGORIES,
  type IndicatorCatalogItemDto,
  type IndicatorCatalogQueryDto,
} from './indicator-catalog.dto';

export const INDICATOR_REGISTRY = Symbol('INDICATOR_REGISTRY');

@Injectable()
export class IndicatorCatalogService {
  constructor(
    @Inject(INDICATOR_REGISTRY)
    private readonly registry: IndicatorRegistry,
  ) {}

  list(query: IndicatorCatalogQueryDto): readonly IndicatorCatalogItemDto[] {
    const category = parseCategory(query.category);
    const status = parseStatus(query.status);
    const search = parseSearch(query.search);

    if (status === 'disabled') return [];
    return this.registry
      .catalog()
      .filter((entry) => category === undefined || entry.category === category)
      .filter((entry) => matchesSearch(entry, search))
      .map(toDto);
  }

  detail(code: string): {
    readonly code: string;
    readonly name: string;
    readonly category: string;
    readonly defaultVersion: number;
    readonly versions: readonly IndicatorCatalogItemDto[];
  } {
    const normalizedCode = code.trim().toUpperCase();
    const versions = this.registry
      .catalog()
      .filter((entry) => entry.code === normalizedCode)
      .sort((left, right) => left.version - right.version);
    const defaultDefinition = versions.at(-1);
    if (defaultDefinition === undefined) {
      throw new NotFoundException({
        code: 'INDICATOR_NOT_FOUND',
        message: 'Indicator was not found',
      });
    }
    return {
      code: defaultDefinition.code,
      name: defaultDefinition.displayName,
      category: defaultDefinition.category,
      defaultVersion: defaultDefinition.version,
      versions: versions.map(toDto),
    };
  }
}

function toDto(entry: IndicatorCatalogEntry): IndicatorCatalogItemDto {
  return {
    code: entry.code,
    version: entry.version,
    name: entry.displayName,
    category: entry.category,
    status: 'enabled',
    parameters: entry.parameterMetadata,
    output: entry.outputMetadata,
  };
}

function parseCategory(
  value: string | undefined,
): IndicatorCategory | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (!INDICATOR_CATEGORIES.some((category) => category === normalized)) {
    throw invalidFilter('category');
  }
  return normalized as IndicatorCategory;
}

function parseStatus(
  value: string | undefined,
): 'enabled' | 'disabled' | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'enabled' && normalized !== 'disabled') {
    throw invalidFilter('status');
  }
  return normalized;
}

function parseSearch(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const normalized = value.trim().toLocaleLowerCase('en-US');
  if (normalized.length > 100) throw invalidFilter('search');
  return normalized;
}

function matchesSearch(
  entry: IndicatorCatalogEntry,
  search: string | undefined,
): boolean {
  return (
    search === undefined ||
    entry.code.toLocaleLowerCase('en-US').includes(search) ||
    entry.displayName.toLocaleLowerCase('en-US').includes(search)
  );
}

function invalidFilter(field: string): BadRequestException {
  return new BadRequestException({
    code: 'INDICATOR_CATALOG_FILTER_INVALID',
    message: `Invalid indicator catalog filter: ${field}`,
  });
}
