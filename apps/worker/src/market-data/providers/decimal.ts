interface DecimalParts {
  readonly digits: string;
  readonly negative: boolean;
  readonly scale: number;
}

function decimalParts(value: string): DecimalParts {
  const negative = value.startsWith('-');
  const unsigned = negative || value.startsWith('+') ? value.slice(1) : value;
  const [integer = '0', fraction = ''] = unsigned.split('.');
  const digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');

  return {
    digits,
    negative: negative && digits !== '0',
    scale: fraction.length,
  };
}

function compareMagnitude(left: DecimalParts, right: DecimalParts): number {
  const scale = Math.max(left.scale, right.scale);
  const leftDigits = left.digits.padEnd(
    left.digits.length + scale - left.scale,
    '0',
  );
  const rightDigits = right.digits.padEnd(
    right.digits.length + scale - right.scale,
    '0',
  );
  const width = Math.max(leftDigits.length, rightDigits.length);
  const paddedLeft = leftDigits.padStart(width, '0');
  const paddedRight = rightDigits.padStart(width, '0');

  return paddedLeft === paddedRight ? 0 : paddedLeft > paddedRight ? 1 : -1;
}

export function compareDecimalStrings(left: string, right: string): number {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);

  if (leftParts.negative !== rightParts.negative) {
    return leftParts.negative ? -1 : 1;
  }

  const magnitude = compareMagnitude(leftParts, rightParts);
  return leftParts.negative ? -magnitude : magnitude;
}
