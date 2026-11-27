/**
 * Shopify Admin CurrencyCode values for API version 2026-07.
 * Precision follows ISO 4217 minor units, with the zero-decimal set Shopify
 * uses for these codes: BIF, CLP, DJF, GNF, ISK, JPY, KMF, KRW, PYG, RWF,
 * UGX, VND, VUV, XAF, XOF, XPF.
 * Three-decimal codes are the ISO 4217 exponent-3 currencies that exist in
 * that enum. PKR and every other listed code use exponent 2.
 * XXX is Shopify's unrecognized currency and is not accepted.
 * USDC has no ISO minor unit; Shopify Money values for it use 2 decimal places.
 */

const ZERO_EXPONENT = [
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
  "BYR",
] as const;

const THREE_EXPONENT = ["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"] as const;

const SHOPIFY_CURRENCY_CODES = [
  "AED", "AFN", "ALL", "AMD", "ANG", "AOA", "ARS", "AUD", "AWG", "AZN",
  "BAM", "BBD", "BDT", "BGN", "BHD", "BIF", "BMD", "BND", "BOB", "BRL",
  "BSD", "BTN", "BWP", "BYN", "BYR", "BZD", "CAD", "CDF", "CHF", "CLP",
  "CNY", "COP", "CRC", "CVE", "CZK", "DJF", "DKK", "DOP", "DZD", "EGP",
  "ERN", "ETB", "EUR", "FJD", "FKP", "GBP", "GEL", "GHS", "GIP", "GMD",
  "GNF", "GTQ", "GYD", "HKD", "HNL", "HRK", "HTG", "HUF", "IDR", "ILS",
  "INR", "IQD", "IRR", "ISK", "JEP", "JMD", "JOD", "JPY", "KES", "KGS",
  "KHR", "KID", "KMF", "KRW", "KWD", "KYD", "KZT", "LAK", "LBP", "LKR",
  "LRD", "LSL", "LTL", "LVL", "LYD", "MAD", "MDL", "MGA", "MKD", "MMK",
  "MNT", "MOP", "MRU", "MUR", "MVR", "MWK", "MXN", "MYR", "MZN", "NAD",
  "NGN", "NIO", "NOK", "NPR", "NZD", "OMR", "PAB", "PEN", "PGK", "PHP",
  "PKR", "PLN", "PYG", "QAR", "RON", "RSD", "RUB", "RWF", "SAR", "SBD",
  "SCR", "SDG", "SEK", "SGD", "SHP", "SLL", "SOS", "SRD", "SSP", "STD",
  "STN", "SYP", "SZL", "THB", "TJS", "TMT", "TND", "TOP", "TRY", "TTD",
  "TWD", "TZS", "UAH", "UGX", "USD", "USDC", "UYU", "UZS", "VED", "VEF",
  "VES", "VND", "VUV", "WST", "XAF", "XCD", "XCG", "XOF", "XPF", "YER",
  "ZAR", "ZMW",
] as const;

const KNOWN = new Set<string>(SHOPIFY_CURRENCY_CODES);
const ZERO = new Set<string>(ZERO_EXPONENT);
const THREE = new Set<string>(THREE_EXPONENT);

export function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

export function isShopifyCurrency(value: string) {
  return KNOWN.has(normalizeCurrencyCode(value));
}

export function currencyExponent(value: string) {
  const code = normalizeCurrencyCode(value);
  if (!KNOWN.has(code)) return null;
  if (ZERO.has(code)) return 0;
  if (THREE.has(code)) return 3;
  return 2;
}

export const shopifyCurrencyCodes = SHOPIFY_CURRENCY_CODES;
