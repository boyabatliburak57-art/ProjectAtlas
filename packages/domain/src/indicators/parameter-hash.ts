import { IndicatorDomainError } from './errors.js';

const FNV_OFFSET_HIGH = 0xcbf29ce4;
const FNV_OFFSET_LOW = 0x84222325;
const FNV_PRIME_HIGH = 0x100;
const FNV_PRIME_LOW = 0x1b3;
const UINT32_SIZE = 0x1_0000_0000;

export function createStableParameterHash(parameters: unknown): string {
  const canonical = canonicalize(parameters, new Set<object>());
  let high = FNV_OFFSET_HIGH;
  let low = FNV_OFFSET_LOW;

  for (let index = 0; index < canonical.length; index += 1) {
    const codeUnit = canonical.charCodeAt(index);
    [high, low] = updateHash(high, low, codeUnit & 0xff);
    [high, low] = updateHash(high, low, codeUnit >>> 8);
  }

  return `fnv1a64:${high.toString(16).padStart(8, '0')}${low.toString(16).padStart(8, '0')}`;
}

function updateHash(
  high: number,
  low: number,
  octet: number,
): readonly [number, number] {
  const xoredLow = (low ^ octet) >>> 0;
  const lowProduct = xoredLow * FNV_PRIME_LOW;
  const nextLow = lowProduct >>> 0;
  const carry = Math.floor(lowProduct / UINT32_SIZE);
  const nextHigh =
    (Math.imul(high, FNV_PRIME_LOW) +
      Math.imul(xoredLow, FNV_PRIME_HIGH) +
      carry) >>>
    0;
  return [nextHigh, nextLow];
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
