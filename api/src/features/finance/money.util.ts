/**
 * Decimal arithmetic for money, on strings.
 *
 * Amounts are `numeric(20, 4)` in Postgres and arrive as strings. Converting
 * them to `number` to add them up is the classic way to lose a cent: 0.1 + 0.2
 * is not 0.3 in binary floating point, and an invoice total that disagrees with
 * the sum of its lines by a rounding error is a support ticket, not a rounding
 * error.
 *
 * These helpers work in integer minor-of-minor units (4 decimal places, matching
 * the column) and return strings, so nothing ever round-trips through a float.
 */

/** Decimal places held in the database. */
export const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

/** Parse a decimal string into scaled integer units. */
export function toUnits(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new Error(`"${text}" is not a decimal amount`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  // Pad or truncate to the column's scale. Truncation (not rounding) is
  // deliberate: an input with more precision than the column can hold is the
  // caller's bug, and silently rounding it hides that.
  const padded = fraction.padEnd(SCALE, '0').slice(0, SCALE);
  const units = BigInt(whole) * FACTOR + BigInt(padded || '0');
  return negative ? -units : units;
}

/** Render scaled integer units back to a decimal string. */
export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / FACTOR;
  const fraction = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

/** Sum decimal strings exactly. */
export function sum(values: Array<string | number | null | undefined>): string {
  return fromUnits(values.reduce<bigint>((acc, v) => acc + toUnits(v), 0n));
}

export function add(a: string, b: string): string {
  return fromUnits(toUnits(a) + toUnits(b));
}

export function subtract(a: string, b: string): string {
  return fromUnits(toUnits(a) - toUnits(b));
}

/**
 * Multiply an amount by a quantity.
 *
 * The product of two scaled integers is scaled twice, so it is divided back
 * once — with half-up rounding, which is what an invoice line is expected to do.
 */
export function multiply(amount: string, quantity: string): string {
  const product = toUnits(amount) * toUnits(quantity);
  return fromUnits(roundedDivide(product, FACTOR));
}

/** A percentage of an amount, e.g. tax. */
export function percentOf(amount: string, percent: string): string {
  const product = toUnits(amount) * toUnits(percent);
  return fromUnits(roundedDivide(product, FACTOR * 100n));
}

/** Convert an amount at a rate, for base-currency reporting. */
export function convert(amount: string, rate: string): string {
  return multiply(amount, rate);
}

export function isNegative(value: string): boolean {
  return toUnits(value) < 0n;
}

export function isZero(value: string): boolean {
  return toUnits(value) === 0n;
}

/** -1, 0 or 1, for comparing amounts without parsing them as numbers. */
export function compare(a: string, b: string): -1 | 0 | 1 {
  const left = toUnits(a);
  const right = toUnits(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Half-up division for positive and negative values alike. */
function roundedDivide(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  const quotient = abs / denominator;
  const remainder = abs % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}
