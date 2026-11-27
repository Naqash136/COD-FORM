import { currencyExponent, normalizeCurrencyCode } from "./currencies";

export type Money = {
  amountMinor: bigint;
  currencyCode: string;
  exponent: number;
};

export type MoneyResult<T> = { ok: true; value: T } | { ok: false; code: string };

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

export function makeMoney(amountMinor: bigint, currencyCode: string): MoneyResult<Money> {
  const code = normalizeCurrencyCode(currencyCode);
  const exponent = currencyExponent(code);
  if (exponent == null) return { ok: false, code: "unknown_currency" };
  if (amountMinor < 0n) return { ok: false, code: "negative_amount" };
  return { ok: true, value: { amountMinor, currencyCode: code, exponent } };
}

export function zeroMoney(currencyCode: string): MoneyResult<Money> {
  return makeMoney(0n, currencyCode);
}

/**
 * Half up, away from zero, for a non-negative numerator and positive denominator.
 * 0.5 minor units rounds to 1. Exact integers stay unchanged.
 */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("numerator must be non-negative");
  return (numerator + denominator / 2n) / denominator;
}

export function parseDecimal(input: string, currencyCode: string): MoneyResult<Money> {
  const code = normalizeCurrencyCode(currencyCode);
  const exponent = currencyExponent(code);
  if (exponent == null) return { ok: false, code: "unknown_currency" };
  const trimmed = input.trim();
  const match = DECIMAL.exec(trimmed);
  if (!match) return { ok: false, code: "invalid_amount" };
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  const significant = fraction.slice(0, exponent);
  const extra = fraction.slice(exponent);
  if ([...extra].some((digit) => digit !== "0")) return { ok: false, code: "too_many_decimals" };
  const padded = significant.padEnd(exponent, "0");
  const minor = BigInt(whole) * 10n ** BigInt(exponent) + (padded === "" ? 0n : BigInt(padded));
  return { ok: true, value: { amountMinor: minor, currencyCode: code, exponent } };
}

export function formatDecimal(money: Money) {
  const negative = money.amountMinor < 0n;
  const absolute = negative ? -money.amountMinor : money.amountMinor;
  const digits = absolute.toString().padStart(money.exponent + 1, "0");
  if (money.exponent === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -money.exponent);
  const fraction = digits.slice(-money.exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function sameCurrency(left: Money, right: Money) {
  return left.currencyCode === right.currencyCode && left.exponent === right.exponent;
}

export function addMoney(left: Money, right: Money): MoneyResult<Money> {
  if (!sameCurrency(left, right)) return { ok: false, code: "mixed_currency" };
  return { ok: true, value: { ...left, amountMinor: left.amountMinor + right.amountMinor } };
}

export function subtractMoney(left: Money, right: Money): MoneyResult<Money> {
  if (!sameCurrency(left, right)) return { ok: false, code: "mixed_currency" };
  if (right.amountMinor > left.amountMinor) return { ok: false, code: "negative_amount" };
  return { ok: true, value: { ...left, amountMinor: left.amountMinor - right.amountMinor } };
}

export function multiplyQuantity(money: Money, quantity: number): MoneyResult<Money> {
  if (!Number.isInteger(quantity) || quantity < 0) return { ok: false, code: "invalid_quantity" };
  return { ok: true, value: { ...money, amountMinor: money.amountMinor * BigInt(quantity) } };
}

export function percentageOf(money: Money, basisPoints: number): MoneyResult<Money> {
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) {
    return { ok: false, code: "invalid_percentage" };
  }
  const amount = divideRoundHalfUp(money.amountMinor * BigInt(basisPoints), 10_000n);
  return { ok: true, value: { ...money, amountMinor: amount } };
}

export function minMoney(left: Money, right: Money): MoneyResult<Money> {
  if (!sameCurrency(left, right)) return { ok: false, code: "mixed_currency" };
  return { ok: true, value: left.amountMinor <= right.amountMinor ? left : right };
}

/** A compare-at price is a promotional reference only when it is above the regular unit price. */
export function promotionalCompareAt(compareAt: Money | null, regular: Money | null): Money | null {
  if (!compareAt || !regular) return null;
  if (!sameCurrency(compareAt, regular)) return null;
  if (compareAt.amountMinor <= regular.amountMinor) return null;
  return compareAt;
}
