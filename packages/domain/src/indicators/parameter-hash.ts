import { IndicatorDomainError } from './errors.js';

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export function createStableParameterHash(parameters: unknown): string {
  const canonical = canonicalize(parameters, new Set<object>());
  let hash = FNV_OFFSET_BASIS;

  for (let index = 0; index < canonical.length; index += 1) {
    const codeUnit = canonical.charCodeAt(index);
    hash = updateHash(hash, codeUnit & 0xff);
    hash = updateHash(hash, codeUnit >>> 8);
  }

  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function updateHash(hash: bigint, octet: number): bigint {
  return ((hash ^ BigInt(octet)) * FNV_PRIME) & UINT64_MASK;
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string'
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalidParameters();
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value !== 'object') throw invalidParameters();
  if (ancestors.has(value)) throw invalidParameters();

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalize(item, ancestors)).join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw invalidParameters();
    }

    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalize(object[key], ancestors)}`,
      );
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function invalidParameters(): IndicatorDomainError {
  return new IndicatorDomainError('INDICATOR_PARAMETERS_INVALID');
}
