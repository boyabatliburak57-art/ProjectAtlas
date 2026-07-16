import { PortfolioError } from './errors.js';

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.(\d+))?$/;
const DATABASE_SCALE = 10;
const DATABASE_INTEGER_DIGITS = 18;
const DIVISION_SCALE = 24;

export class Decimal {
  private constructor(
    private readonly coefficient: bigint,
    private readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0);

  static parse(value: string, field = 'value'): Decimal {
    const normalized = value.trim();
    const match = DECIMAL_PATTERN.exec(normalized);
    if (match === null) {
      throw new PortfolioError('PORTFOLIO_DECIMAL_INVALID', { field });
    }
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [whole = '0', fraction = ''] = unsigned.split('.');
    const coefficient = BigInt(`${whole}${fraction}`) * (negative ? -1n : 1n);
    return new Decimal(coefficient, fraction.length).normalized();
  }

  plus(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(
      this.coefficient * powerOfTen(scale - this.scale) +
        other.coefficient * powerOfTen(scale - other.scale),
      scale,
    ).normalized();
  }

  minus(other: Decimal): Decimal {
    return this.plus(new Decimal(-other.coefficient, other.scale));
  }

  times(other: Decimal): Decimal {
    return new Decimal(
      this.coefficient * other.coefficient,
      this.scale + other.scale,
    ).normalized();
  }

  dividedBy(other: Decimal, resultScale = DIVISION_SCALE): Decimal {
    if (other.coefficient === 0n) {
      throw new PortfolioError('PORTFOLIO_DECIMAL_INVALID', {
        reason: 'division_by_zero',
      });
    }
    const exponent = other.scale + resultScale - this.scale;
    const numerator =
      exponent >= 0
        ? this.coefficient * powerOfTen(exponent)
        : this.coefficient;
    const denominator =
      exponent >= 0
        ? other.coefficient
        : other.coefficient * powerOfTen(-exponent);
    return new Decimal(
      divideHalfEven(numerator, denominator),
      resultScale,
    ).normalized();
  }

  compare(other: Decimal): number {
    const scale = Math.max(this.scale, other.scale);
    const left = this.coefficient * powerOfTen(scale - this.scale);
    const right = other.coefficient * powerOfTen(scale - other.scale);
    return left < right ? -1 : left > right ? 1 : 0;
  }

  isZero(): boolean {
    return this.coefficient === 0n;
  }

  isNegative(): boolean {
    return this.coefficient < 0n;
  }

  toDatabaseString(field = 'value'): string {
    const rounded = this.round(DATABASE_SCALE);
    const value = rounded.toString();
    const whole = value.replace(/^-/, '').split('.')[0] ?? '0';
    if (whole.length > DATABASE_INTEGER_DIGITS) {
      throw new PortfolioError('PORTFOLIO_DECIMAL_OVERFLOW', { field });
    }
    return value;
  }

  toString(): string {
    const normalized = this.normalized();
    const negative = normalized.coefficient < 0n;
    const digits = (
      negative ? -normalized.coefficient : normalized.coefficient
    ).toString();
    if (normalized.scale === 0) return `${negative ? '-' : ''}${digits}`;
    const padded = digits.padStart(normalized.scale + 1, '0');
    const split = padded.length - normalized.scale;
    return `${negative ? '-' : ''}${padded.slice(0, split)}.${padded.slice(split)}`;
  }

  private round(targetScale: number): Decimal {
    if (this.scale <= targetScale) return this;
    const divisor = powerOfTen(this.scale - targetScale);
    return new Decimal(
      divideHalfEven(this.coefficient, divisor),
      targetScale,
    ).normalized();
  }

  private normalized(): Decimal {
    if (this.coefficient === 0n) return Decimal.ZERO;
    let coefficient = this.coefficient;
    let scale = this.scale;
    while (scale > 0 && coefficient % 10n === 0n) {
      coefficient /= 10n;
      scale -= 1;
    }
    return coefficient === this.coefficient && scale === this.scale
      ? this
      : new Decimal(coefficient, scale);
  }
}

export function parseLedgerDecimal(
  value: string,
  field: string,
  options: { readonly nonNegative?: boolean; readonly positive?: boolean } = {},
): Decimal {
  const normalized = value.trim();
  const decimal = Decimal.parse(normalized, field);
  const unsigned = normalized.replace(/^-/, '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (
    whole.replace(/^0+/, '').length > DATABASE_INTEGER_DIGITS ||
    fraction.length > DATABASE_SCALE
  ) {
    throw new PortfolioError('PORTFOLIO_DECIMAL_OVERFLOW', { field });
  }
  if (options.nonNegative && decimal.isNegative()) {
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', { field });
  }
  if (options.positive && (decimal.isNegative() || decimal.isZero())) {
    throw new PortfolioError('PORTFOLIO_TRANSACTION_INVALID', { field });
  }
  return decimal;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const sign = numerator < 0n !== denominator < 0n ? -1n : 1n;
  const positiveNumerator = numerator < 0n ? -numerator : numerator;
  const positiveDenominator = denominator < 0n ? -denominator : denominator;
  const quotient = positiveNumerator / positiveDenominator;
  const remainder = positiveNumerator % positiveDenominator;
  const doubled = remainder * 2n;
  const rounded =
    doubled > positiveDenominator ||
    (doubled === positiveDenominator && quotient % 2n !== 0n)
      ? quotient + 1n
      : quotient;
  return rounded * sign;
}
