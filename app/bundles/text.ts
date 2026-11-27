import { divideRoundHalfUp, formatDecimal, type Money } from "./money";
import type { DealQuote } from "./pricing";
import { TEXT_VARIABLES } from "./schema";

const TOKEN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const APPROVED = new Set<string>(TEXT_VARIABLES);

export const VARIABLE_MENU = [
  { token: "product", label: "Product" },
  { token: "quantity", label: "Quantity" },
  { token: "buy_quantity", label: "Buy quantity" },
  { token: "get_quantity", label: "Get quantity" },
  { token: "saved_amount", label: "Saved amount" },
  { token: "saved_percentage", label: "Saved percentage" },
  { token: "product_title", label: "Product title" },
  { token: "regular_price", label: "Regular price" },
  { token: "compare_at_price", label: "Compare-at price" },
  { token: "final_price", label: "Final price" },
  { token: "discount", label: "Discount" },
  { token: "savings", label: "Savings" },
  { token: "currency", label: "Currency" },
] as const;

export type TemplateValues = {
  product: string;
  quantity: string;
  buyQuantity: string;
  getQuantity: string;
  regularPrice: string;
  compareAtPrice: string;
  finalPrice: string;
  discount: string;
  savings: string;
  savedPercentage: string;
  currency: string;
};

export function resolveTemplate(template: string, values: TemplateValues) {
  return template.replace(TOKEN, (match, name: string) => {
    if (!APPROVED.has(name)) return match;
    return valueFor(name, values);
  });
}

export function customerFacingSavings(quote: DealQuote): { amount: Money; reference: Money } {
  const compareAt = quote.compareAt.coverage === "complete" ? quote.compareAt.savings : null;
  if (compareAt) {
    const lines = quote.lines.filter((line) => line.compareAtLinePrice);
    if (lines.length === quote.lines.length && lines.length > 0) {
      const total = lines.reduce((sum, line) => sum + (line.compareAtLinePrice?.amountMinor ?? 0n), 0n);
      return {
        amount: nonNegative(compareAt),
        reference: { ...quote.finalTotal, amountMinor: total },
      };
    }
  }
  return { amount: nonNegative(quote.discountSavings), reference: quote.regularTotal };
}

function nonNegative(money: Money): Money {
  return money.amountMinor < 0n ? { ...money, amountMinor: 0n } : money;
}

export function savedPercentageLabel(regular: Money, savings: Money) {
  if (regular.amountMinor <= 0n || regular.currencyCode !== savings.currencyCode) return "0%";
  const basis = divideRoundHalfUp(savings.amountMinor * 10_000n, regular.amountMinor);
  const capped = basis > 10_000n ? 10_000n : basis;
  const whole = capped / 100n;
  const fraction = capped % 100n;
  if (fraction === 0n) return `${whole}%`;
  return `${whole}.${fraction.toString().padStart(2, "0")}%`;
}

export function moneyLabel(money: Money) {
  return `${formatDecimal(money)} ${money.currencyCode}`;
}

function valueFor(name: string, values: TemplateValues) {
  if (name === "product" || name === "product_title") return values.product;
  if (name === "quantity") return values.quantity;
  if (name === "buy_quantity") return values.buyQuantity;
  if (name === "get_quantity") return values.getQuantity;
  if (name === "regular_price") return values.regularPrice;
  if (name === "compare_at_price") return values.compareAtPrice;
  if (name === "final_price") return values.finalPrice;
  if (name === "discount") return values.discount;
  if (name === "savings" || name === "saved_amount") return values.savings;
  if (name === "saved_percentage") return values.savedPercentage;
  if (name === "currency") return values.currency;
  return "";
}
