import {
  addMoney,
  divideRoundHalfUp,
  makeMoney,
  minMoney,
  multiplyQuantity,
  percentageOf,
  promotionalCompareAt,
  subtractMoney,
  zeroMoney,
  type Money,
} from "./money";
import { currencyExponent, normalizeCurrencyCode } from "./currencies";
import type { BundleDocument, PricingConfig, StoredMoney } from "./schema";

export type QuoteRole = "merchandise" | "upsell" | "gift";

export type QuoteLineInput = {
  lineId: string;
  barId: string;
  role: QuoteRole;
  quantity: number;
  regularUnitPrice: Money | null;
  compareAtUnitPrice: Money | null;
  available: boolean;
  restrictWhenSoldOut: boolean;
  groupId: string;
  adjustment: PricingConfig;
};

export type QuotedLine = {
  lineId: string;
  barId: string;
  role: QuoteRole;
  quantity: number;
  currencyCode: string;
  regularUnitPrice: Money;
  compareAtUnitPrice: Money | null;
  regularLinePrice: Money;
  compareAtLinePrice: Money | null;
  appliedDiscount: Money;
  finalLinePrice: Money;
  discountSavings: Money;
  compareAtSavings: Money | null;
};

export type DealQuote = {
  currencyCode: string;
  lines: QuotedLine[];
  regularTotal: Money;
  appliedDiscountTotal: Money;
  finalTotal: Money;
  discountSavings: Money;
  compareAt: {
    savings: Money | null;
    coverage: "none" | "partial" | "complete";
  };
  freeShipping: boolean;
  maximumShippingRate: Money | null;
};

export type QuoteIssue = {
  code: string;
  message: string;
  lineId?: string;
};

export type QuoteResult =
  | { ok: true; quote: DealQuote }
  | { ok: false; errors: QuoteIssue[] };

export type PricePoint = {
  regular: Money | null;
  compareAt: Money | null;
  available: boolean;
};

export type PriceBook = {
  currencyCode: string;
  variants: Record<string, PricePoint>;
};

export type VerifiedCollectionMembership = {
  collectionId: string;
  productId: string;
  variantIds: string[];
};

export type BarSelection = {
  barId: string;
  quantity?: number;
  sets?: number;
  giftIds?: string[];
  upsellIds?: string[];
  variantId?: string;
  getVariantId?: string;
  slots?: Array<{ slotId: string; variantId: string }>;
  products?: Array<{ productId: string; quantity?: number; variantId?: string }>;
};

type Working = QuoteLineInput & {
  regularUnitPrice: Money;
  regularLinePrice: Money;
  compareAtLinePrice: Money | null;
};

export function quoteLines(
  lines: QuoteLineInput[],
  currencyCode: string,
  freeShipping = false,
): QuoteResult {
  const currency = normalizeCurrencyCode(currencyCode);
  const zero = zeroMoney(currency);
  if (!zero.ok) return fail("unknown_currency", "Currency is not a Shopify currency.");
  if (lines.length === 0) {
    return {
      ok: true,
      quote: emptyQuote(zero.value, freeShipping),
    };
  }

  const errors: QuoteIssue[] = [];
  const working: Working[] = [];
  for (const line of lines) {
    const prepared = prepareLine(line, currency, errors);
    if (prepared) working.push(prepared);
  }
  if (errors.length > 0) return { ok: false, errors };

  const priced = new Map<string, { final: Money; discount: Money }>();
  for (const gift of working.filter((line) => line.role === "gift")) {
    const zeroLine = zeroMoney(currency);
    if (!zeroLine.ok) return fail("unknown_currency", "Currency is not a Shopify currency.");
    priced.set(gift.lineId, { final: zeroLine.value, discount: gift.regularLinePrice });
  }

  const groups = new Map<string, Working[]>();
  for (const line of working.filter((item) => item.role !== "gift")) {
    const group = groups.get(line.groupId) ?? [];
    group.push(line);
    groups.set(line.groupId, group);
  }

  for (const group of groups.values()) {
    const applied = applyGroup(group, currency, errors);
    if (!applied) continue;
    for (const line of applied) priced.set(line.lineId, { final: line.final, discount: line.discount });
  }
  if (errors.length > 0) return { ok: false, errors };

  const quoted: QuotedLine[] = [];
  for (const line of working) {
    const result = priced.get(line.lineId);
    if (!result) {
      errors.push({ code: "unpriced_line", message: "A line was not priced.", lineId: line.lineId });
      continue;
    }
    const savings = subtractMoney(line.regularLinePrice, minOf(line.regularLinePrice, result.final));
    if (!savings.ok) {
      errors.push({ code: savings.code, message: "Could not calculate discount savings.", lineId: line.lineId });
      continue;
    }
    quoted.push({
      lineId: line.lineId,
      barId: line.barId,
      role: line.role,
      quantity: line.quantity,
      currencyCode: currency,
      regularUnitPrice: line.regularUnitPrice,
      compareAtUnitPrice: line.compareAtUnitPrice,
      regularLinePrice: line.regularLinePrice,
      compareAtLinePrice: line.compareAtLinePrice,
      appliedDiscount: result.discount,
      finalLinePrice: result.final,
      discountSavings: savings.value,
      compareAtSavings: compareAtSavings(line.compareAtLinePrice, result.final),
    });
  }
  if (errors.length > 0) return { ok: false, errors };

  const regularTotal = mustSum(quoted.map((line) => line.regularLinePrice), zero.value);
  const appliedDiscountTotal = mustSum(quoted.map((line) => line.appliedDiscount), zero.value);
  const finalTotal = mustSum(quoted.map((line) => line.finalLinePrice), zero.value);
  const discountSavings = mustSum(quoted.map((line) => line.discountSavings), zero.value);
  if (!regularTotal.ok || !appliedDiscountTotal.ok || !finalTotal.ok || !discountSavings.ok) {
    return fail("mixed_currency", "The quote mixed currencies.");
  }

  const compareAtLines = quoted.filter((line) => line.compareAtSavings != null);
  const coverage = compareAtLines.length === 0
    ? "none"
    : compareAtLines.length === quoted.length
      ? "complete"
      : "partial";
  const compareAtSavingsTotal = compareAtLines.length === 0
    ? null
    : mustSum(compareAtLines.map((line) => line.compareAtSavings!), zero.value);
  if (compareAtSavingsTotal && !compareAtSavingsTotal.ok) {
    return fail("mixed_currency", "Compare-at prices mixed currencies.");
  }
  let compareSavings = compareAtSavingsTotal?.ok ? compareAtSavingsTotal.value : null;
  if (coverage === "complete") {
    const comparePrices = quoted.map((line) => line.compareAtLinePrice).filter((price): price is Money => price != null);
    const compareTotal = mustSum(comparePrices, zero.value);
    if (!compareTotal.ok) return fail("mixed_currency", "Compare-at prices mixed currencies.");
    const difference = compareTotal.value.amountMinor - finalTotal.value.amountMinor;
    const adjusted = makeMoney(difference > 0n ? difference : 0n, currency);
    if (!adjusted.ok) return fail(adjusted.code, "Could not calculate compare-at savings.");
    compareSavings = adjusted.value;
  }

  return {
    ok: true,
    quote: {
      currencyCode: currency,
      lines: quoted,
      regularTotal: regularTotal.value,
      appliedDiscountTotal: appliedDiscountTotal.value,
      finalTotal: finalTotal.value,
      discountSavings: discountSavings.value,
      compareAt: {
        savings: compareSavings,
        coverage,
      },
      freeShipping,
      maximumShippingRate: null,
    },
  };
}

export function quoteDocument(
  document: BundleDocument,
  selection: { bars: BarSelection[] },
  prices: PriceBook,
  context: { memberships?: VerifiedCollectionMembership[] } = {},
): QuoteResult {
  const currency = normalizeCurrencyCode(prices.currencyCode);
  if (currencyExponent(currency) == null) return fail("unknown_currency", "Currency is not a Shopify currency.");
  const errors: QuoteIssue[] = [];
  const lines: QuoteLineInput[] = [];
  let freeShipping = false;
  const selectedIds = new Set<string>();

  for (const selected of selection.bars) {
    if (selectedIds.has(selected.barId)) {
      errors.push({ code: "duplicate_selection", message: "A bar was selected twice." });
      continue;
    }
    selectedIds.add(selected.barId);
    const bar = document.bars.find((item) => item.id === selected.barId);
    if (!bar) {
      errors.push({ code: "unknown_bar", message: "Selected bar does not exist." });
      continue;
    }
    if (bar.freeShipping.enabled) freeShipping = true;
    lines.push(...linesForBar(bar, selected, prices, currency, context.memberships ?? [], errors));
  }
  if (errors.length > 0) return { ok: false, errors };
  const quoted = quoteLines(lines, currency, freeShipping);
  if (!quoted.ok) return quoted;
  const maximumShippingRate = shippingCap(document, selection.bars, currency, errors);
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, quote: { ...quoted.quote, maximumShippingRate } };
}

function shippingCap(
  document: BundleDocument,
  selections: BarSelection[],
  currency: string,
  errors: QuoteIssue[],
) {
  const enabled = selections.flatMap((selected) => {
    const bar = document.bars.find((item) => item.id === selected.barId);
    return bar?.freeShipping.enabled ? [bar.freeShipping] : [];
  });
  if (enabled.length === 0 || enabled.some((shipping) => shipping.maximumRate == null)) return null;
  const rates = enabled.map((shipping) => storedToMoney(shipping.maximumRate!, currency, errors));
  if (rates.some((rate) => rate == null)) return null;
  return rates.reduce((lowest, rate) => rate!.amountMinor < lowest!.amountMinor ? rate : lowest);
}

function linesForBar(
  bar: BundleDocument["bars"][number],
  selected: BarSelection,
  prices: PriceBook,
  currency: string,
  memberships: VerifiedCollectionMembership[],
  errors: QuoteIssue[],
): QuoteLineInput[] {
  const lines = merchandiseForBar(bar, selected, prices, currency, memberships, errors);
  for (const upsellId of selected.upsellIds ?? []) {
    const upsell = bar.upsells.find((item) => item.id === upsellId);
    if (!upsell) {
      errors.push({ code: "unknown_upsell", message: "Selected upsell does not exist." });
      continue;
    }
    lines.push(pricedVariant({
      lineId: `${bar.id}:upsell:${upsell.id}`,
      barId: bar.id,
      role: "upsell",
      quantity: upsell.quantity,
      variantId: upsell.product.selectedVariantId,
      prices,
      currency,
      groupId: `${bar.id}:upsell:${upsell.id}`,
      adjustment: upsell.pricing,
      errors,
    }));
  }
  if (bar.gifts.selection === "multiple") {
    for (const giftId of selected.giftIds ?? []) {
      if (!bar.gifts.items.some((item) => item.id === giftId)) {
        errors.push({ code: "unknown_gift", message: "Selected gift does not exist." });
      }
    }
  }
  const gifts = bar.gifts.selection === "single"
    ? bar.gifts.items
    : bar.gifts.items.filter((gift) => (selected.giftIds ?? []).includes(gift.id));
  for (const gift of gifts) {
    lines.push(pricedVariant({
      lineId: `${bar.id}:gift:${gift.id}`,
      barId: bar.id,
      role: "gift",
      quantity: gift.quantity,
      variantId: gift.product.selectedVariantId,
      prices,
      currency,
      groupId: `${bar.id}:gift:${gift.id}`,
      adjustment: { mode: "full_price" },
      errors,
    }));
  }
  return lines.filter((line) => line.lineId !== "");
}

function merchandiseForBar(
  bar: BundleDocument["bars"][number],
  selected: BarSelection,
  prices: PriceBook,
  currency: string,
  memberships: VerifiedCollectionMembership[],
  errors: QuoteIssue[],
): QuoteLineInput[] {
  if (bar.type === "quantity_break") {
    const quantity = customerQuantity(bar.config.quantity, bar.config.quantitySelector, selected.quantity, errors);
    const variantId = chosenVariant(bar.config.product, selected.variantId, errors, `${bar.id}:product`);
    if (quantity == null || !variantId) return [];
    return [pricedVariant({
      lineId: `${bar.id}:product`,
      barId: bar.id,
      role: "merchandise",
      quantity,
      variantId,
      prices,
      currency,
      groupId: `${bar.id}:merchandise`,
      adjustment: scaleFixed(bar.pricing, quantity, bar.config.quantity),
      errors,
    })].filter((line) => line.lineId !== "");
  }

  if (bar.type === "buy_x_get_y") {
    const sets = selected.sets ?? 1;
    if (!Number.isInteger(sets) || sets < 1 || sets > 999) {
      errors.push({ code: "invalid_quantity", message: "Offer quantity is invalid." });
      return [];
    }
    const getProduct = bar.config.getProduct ?? bar.config.product;
    const buyVariantId = chosenVariant(bar.config.product, selected.variantId, errors, `${bar.id}:buy`);
    const getVariantId = chosenVariant(getProduct, selected.getVariantId, errors, `${bar.id}:get`);
    if (!buyVariantId || !getVariantId) return [];
    return [
      pricedVariant({
        lineId: `${bar.id}:buy`,
        barId: bar.id,
        role: "merchandise",
        quantity: bar.config.buyQuantity * sets,
        variantId: buyVariantId,
        prices,
        currency,
        groupId: `${bar.id}:buy`,
        adjustment: scaleFixed(bar.pricing, sets, 1),
        errors,
      }),
      pricedVariant({
        lineId: `${bar.id}:get`,
        barId: bar.id,
        role: "merchandise",
        quantity: bar.config.getQuantity * sets,
        variantId: getVariantId,
        prices,
        currency,
        groupId: `${bar.id}:get`,
        adjustment: scaleFixed(bar.config.getPricing, sets, 1),
        errors,
      }),
    ].filter((line) => line.lineId !== "");
  }

  if (bar.type === "product_bundle") {
    return bar.config.products.flatMap((product) => {
      const choice = selected.products?.find((item) => item.productId === product.id);
      const quantity = customerQuantity(product.quantity, product.quantitySelector, choice?.quantity, errors);
      const variantId = chosenVariant(product.product, choice?.variantId, errors, `${bar.id}:product:${product.id}`);
      if (quantity == null || !variantId) return [];
      return [pricedVariant({
        lineId: `${bar.id}:product:${product.id}`,
        barId: bar.id,
        role: "merchandise",
        quantity,
        variantId,
        prices,
        currency,
        groupId: `${bar.id}:product:${product.id}`,
        adjustment: scaleFixed(product.pricing, quantity, product.quantity),
        errors,
      })].filter((line) => line.lineId !== "");
    });
  }

  if (bar.type === "mix_and_match") {
    return bar.config.slots.flatMap((slot) => {
      const choice = selected.slots?.find((item) => item.slotId === slot.id);
      const variantId = choice?.variantId ?? slot.product.selectedVariantId;
      const allowed = slot.product.allowedVariantIds.includes(variantId)
        || slot.swapProducts.some((product) => product.allowedVariantIds.includes(variantId))
        || memberships.some((membership) => slot.swapCollectionIds.includes(membership.collectionId) && membership.variantIds.includes(variantId));
      if (!allowed) {
        errors.push({ code: "unknown_swap", message: "Selected product is not available in this slot.", lineId: slot.id });
        return [];
      }
      return [pricedVariant({
        lineId: `${bar.id}:slot:${slot.id}`,
        barId: bar.id,
        role: "merchandise",
        quantity: 1,
        variantId,
        prices,
        currency,
        groupId: `${bar.id}:merchandise`,
        adjustment: bar.pricing,
        errors,
      })].filter((line) => line.lineId !== "");
    });
  }

  if (selected.quantity != null && selected.quantity !== bar.config.quantity) {
    errors.push({ code: "quantity_locked", message: "This quantity is fixed." });
    return [];
  }
  const variantId = chosenVariant(bar.config.product, selected.variantId, errors, `${bar.id}:alternative`);
  if (!variantId) return [];
  return [pricedVariant({
    lineId: `${bar.id}:alternative`,
    barId: bar.id,
    role: "merchandise",
    quantity: bar.config.quantity,
    variantId,
    prices,
    currency,
    groupId: `${bar.id}:merchandise`,
    adjustment: scaleFixed(bar.pricing, bar.config.quantity, bar.config.quantity),
    errors,
  })].filter((line) => line.lineId !== "");
}

function chosenVariant(
  product: { allowedVariantIds: string[]; selectedVariantId: string },
  requested: string | undefined,
  errors: QuoteIssue[],
  lineId: string,
) {
  const variantId = requested ?? product.selectedVariantId;
  if (!product.allowedVariantIds.includes(variantId)) {
    errors.push({ code: "variant_not_allowed", message: "Selected variant is not allowed for this product.", lineId });
    return null;
  }
  return variantId;
}

function customerQuantity(
  configured: number,
  selector: boolean,
  requested: number | undefined,
  errors: QuoteIssue[],
) {
  if (!selector) {
    if (requested != null && requested !== configured) {
      errors.push({ code: "quantity_locked", message: "This quantity is fixed." });
      return null;
    }
    return configured;
  }
  if (requested == null) return configured;
  return requiredQuantity(requested, errors);
}

function scaleFixed(pricing: PricingConfig, numerator: number, denominator: number): PricingConfig {
  if (pricing.mode !== "fixed_price" || denominator <= 0) return pricing;
  const scaled = divideRoundHalfUp(BigInt(pricing.amount.amountMinor) * BigInt(numerator), BigInt(denominator));
  return {
    mode: "fixed_price",
    scope: pricing.scope,
    amount: { amountMinor: scaled.toString(), currencyCode: pricing.amount.currencyCode },
  };
}

function pricedVariant(input: {
  lineId: string;
  barId: string;
  role: QuoteRole;
  quantity: number;
  variantId: string;
  prices: PriceBook;
  currency: string;
  groupId: string;
  adjustment: PricingConfig;
  errors: QuoteIssue[];
}): QuoteLineInput {
  return lineFromVariant({ ...input, restrictWhenSoldOut: true, errors: input.errors });
}

function lineFromVariant(input: {
  lineId: string;
  barId: string;
  role: QuoteRole;
  quantity: number;
  variantId: string;
  prices: PriceBook;
  currency: string;
  restrictWhenSoldOut: boolean;
  groupId: string;
  adjustment: PricingConfig;
  errors: QuoteIssue[];
}): QuoteLineInput {
  const point = input.prices.variants[input.variantId];
  if (!point) {
    input.errors.push({ code: "missing_price", message: "Variant price is missing.", lineId: input.lineId });
    return blank(input);
  }
  if (point.regular && point.regular.currencyCode !== input.currency) {
    input.errors.push({ code: "mixed_currency", message: "Variant currency does not match the quote.", lineId: input.lineId });
  }
  if (point.compareAt && point.compareAt.currencyCode !== input.currency) {
    input.errors.push({ code: "mixed_currency", message: "Compare-at currency does not match the quote.", lineId: input.lineId });
  }
  return {
    lineId: input.lineId,
    barId: input.barId,
    role: input.role,
    quantity: input.quantity,
    regularUnitPrice: point.regular,
    compareAtUnitPrice: point.compareAt,
    available: point.available,
    restrictWhenSoldOut: input.restrictWhenSoldOut,
    groupId: input.groupId,
    adjustment: input.adjustment,
  };
}

function blank(input: { lineId: string; barId: string; role: QuoteRole; quantity: number; groupId: string; adjustment: PricingConfig; restrictWhenSoldOut: boolean }): QuoteLineInput {
  return {
    lineId: "",
    barId: input.barId,
    role: input.role,
    quantity: input.quantity,
    regularUnitPrice: null,
    compareAtUnitPrice: null,
    available: false,
    restrictWhenSoldOut: input.restrictWhenSoldOut,
    groupId: input.groupId,
    adjustment: input.adjustment,
  };
}

function requiredQuantity(value: number | undefined, errors: QuoteIssue[]) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 999) {
    errors.push({ code: "invalid_quantity", message: "Quantity is required." });
    return null;
  }
  return value;
}

function prepareLine(line: QuoteLineInput, currency: string, errors: QuoteIssue[]): Working | null {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) {
    errors.push({ code: "invalid_quantity", message: "Quantity is invalid.", lineId: line.lineId });
    return null;
  }
  if (!line.available) {
    errors.push({ code: "sold_out", message: "This selection is sold out.", lineId: line.lineId });
    return null;
  }
  if (!line.regularUnitPrice) {
    errors.push({ code: "missing_price", message: "Regular price is missing.", lineId: line.lineId });
    return null;
  }
  if (line.regularUnitPrice.currencyCode !== currency || line.regularUnitPrice.exponent !== currencyExponent(currency)) {
    errors.push({ code: "mixed_currency", message: "Regular price currency does not match the quote.", lineId: line.lineId });
    return null;
  }
  if (line.compareAtUnitPrice && (line.compareAtUnitPrice.currencyCode !== currency || line.compareAtUnitPrice.exponent !== currencyExponent(currency))) {
    errors.push({ code: "mixed_currency", message: "Compare-at currency does not match the quote.", lineId: line.lineId });
    return null;
  }
  const compareAtUnitPrice = promotionalCompareAt(line.compareAtUnitPrice, line.regularUnitPrice);
  const regularLinePrice = multiplyQuantity(line.regularUnitPrice, line.quantity);
  if (!regularLinePrice.ok) {
    errors.push({ code: regularLinePrice.code, message: "Could not price the line.", lineId: line.lineId });
    return null;
  }
  const compareAtLinePrice = compareAtUnitPrice
    ? multiplyQuantity(compareAtUnitPrice, line.quantity)
    : null;
  if (compareAtLinePrice && !compareAtLinePrice.ok) {
    errors.push({ code: compareAtLinePrice.code, message: "Could not price compare-at.", lineId: line.lineId });
    return null;
  }
  return {
    ...line,
    regularUnitPrice: line.regularUnitPrice,
    compareAtUnitPrice,
    regularLinePrice: regularLinePrice.value,
    compareAtLinePrice: compareAtLinePrice && compareAtLinePrice.ok ? compareAtLinePrice.value : null,
  };
}

function applyGroup(group: Working[], currency: string, errors: QuoteIssue[]) {
  const adjustment = group[0]?.adjustment;
  if (!adjustment || group.some((line) => !sameAdjustment(line.adjustment, adjustment))) {
    errors.push({ code: "inconsistent_adjustment", message: "A deal group has mixed pricing." });
    return null;
  }
  if (adjustment.mode === "full_price" || adjustment.scope !== "per_deal") {
    return group.map((line) => priceLine(line, adjustment, currency, errors)).filter((line) => line != null);
  }
  return priceDeal(group, adjustment, currency, errors);
}

function priceLine(
  line: Working,
  adjustment: PricingConfig,
  currency: string,
  errors: QuoteIssue[],
) {
  const zero = zeroMoney(currency);
  if (!zero.ok) return null;
  if (adjustment.mode === "full_price") {
    return { lineId: line.lineId, final: line.regularLinePrice, discount: zero.value };
  }
  if (adjustment.mode === "percentage_off") {
    if (adjustment.scope !== "per_line") return null;
    const discount = percentageOf(line.regularLinePrice, adjustment.basisPoints);
    if (!discount.ok) return null;
    const capped = minMoney(discount.value, line.regularLinePrice);
    if (!capped.ok) return null;
    const final = subtractMoney(line.regularLinePrice, capped.value);
    if (!final.ok) return null;
    return { lineId: line.lineId, final: final.value, discount: capped.value };
  }
  const amount = storedToMoney(adjustment.amount, currency, errors, line.lineId);
  if (!amount) return null;
  if (adjustment.mode === "amount_off") {
    if (adjustment.scope !== "per_item") return null;
    const gross = multiplyQuantity(amount, line.quantity);
    if (!gross.ok) return null;
    const discount = minMoney(gross.value, line.regularLinePrice);
    if (!discount.ok) return null;
    const final = subtractMoney(line.regularLinePrice, discount.value);
    if (!final.ok) return null;
    return { lineId: line.lineId, final: final.value, discount: discount.value };
  }
  if (adjustment.scope !== "per_group") return null;
  const discount = line.regularLinePrice.amountMinor > amount.amountMinor
    ? subtractMoney(line.regularLinePrice, amount)
    : zeroMoney(currency);
  if (!discount.ok) return null;
  return { lineId: line.lineId, final: amount, discount: discount.value };
}

function priceDeal(
  group: Working[],
  adjustment: Extract<PricingConfig, { mode: "percentage_off" | "amount_off" | "fixed_price" }>,
  currency: string,
  errors: QuoteIssue[],
) {
  if (adjustment.scope !== "per_deal") return null;
  const zero = zeroMoney(currency);
  if (!zero.ok) return null;
  const base = mustSum(group.map((line) => line.regularLinePrice), zero.value);
  if (!base.ok) {
    errors.push({ code: base.code, message: "Could not total the deal." });
    return null;
  }
  if (adjustment.mode === "percentage_off") {
    const discount = percentageOf(base.value, adjustment.basisPoints);
    if (!discount.ok) return null;
    return allocateDiscount(group, discount.value, currency);
  }
  if (adjustment.mode === "amount_off") {
    const amount = storedToMoney(adjustment.amount, currency, errors);
    if (!amount) return null;
    const discount = minMoney(amount, base.value);
    if (!discount.ok) return null;
    return allocateDiscount(group, discount.value, currency);
  }
  const amount = storedToMoney(adjustment.amount, currency, errors);
  if (!amount) return null;
  if (base.value.amountMinor === 0n && amount.amountMinor > 0n) {
    errors.push({ code: "fixed_price_without_base", message: "Fixed deal price needs a regular merchandise total." });
    return null;
  }
  const finals = allocate(amount.amountMinor, group.map((line) => line.regularLinePrice.amountMinor));
  return group.map((line, index) => {
    const final = makeMoney(finals[index] ?? 0n, currency);
    if (!final.ok) return null;
    const discount = line.regularLinePrice.amountMinor > final.value.amountMinor
      ? subtractMoney(line.regularLinePrice, final.value)
      : zeroMoney(currency);
    if (!discount.ok) return null;
    return { lineId: line.lineId, final: final.value, discount: discount.value };
  }).filter((line) => line != null);
}

function allocateDiscount(group: Working[], discount: Money, currency: string) {
  const shares = allocate(discount.amountMinor, group.map((line) => line.regularLinePrice.amountMinor));
  return group.map((line, index) => {
    const share = makeMoney(shares[index] ?? 0n, currency);
    if (!share.ok) return null;
    const capped = minMoney(share.value, line.regularLinePrice);
    if (!capped.ok) return null;
    const final = subtractMoney(line.regularLinePrice, capped.value);
    if (!final.ok) return null;
    return { lineId: line.lineId, final: final.value, discount: capped.value };
  }).filter((line) => line != null);
}

function allocate(total: bigint, weights: bigint[]) {
  const base = weights.reduce((sum, weight) => sum + weight, 0n);
  if (weights.length === 0) return [];
  if (base === 0n) {
    return weights.map((_, index) => index === weights.length - 1 ? total : 0n);
  }
  const shares = weights.map((weight) => (total * weight) / base);
  let remainder = total - shares.reduce((sum, share) => sum + share, 0n);
  const order = weights.map((weight, index) => ({ index, remainder: (total * weight) % base }));
  order.sort((left, right) => {
    if (left.remainder === right.remainder) return left.index - right.index;
    return left.remainder > right.remainder ? -1 : 1;
  });
  for (const entry of order) {
    if (remainder === 0n) break;
    const current = shares[entry.index] ?? 0n;
    shares[entry.index] = current + 1n;
    remainder -= 1n;
  }
  return shares;
}

function storedToMoney(amount: StoredMoney, currency: string, errors: QuoteIssue[], lineId?: string) {
  if (normalizeCurrencyCode(amount.currencyCode) !== currency) {
    errors.push({ code: "mixed_currency", message: "Adjustment currency does not match the quote.", lineId });
    return null;
  }
  try {
    const parsed = makeMoney(BigInt(amount.amountMinor), currency);
    if (!parsed.ok) {
      errors.push({ code: parsed.code, message: "Adjustment amount is invalid.", lineId });
      return null;
    }
    return parsed.value;
  } catch {
    errors.push({ code: "invalid_amount", message: "Adjustment amount is invalid.", lineId });
    return null;
  }
}

function compareAtSavings(compareAt: Money | null, final: Money) {
  if (!compareAt) return null;
  if (compareAt.amountMinor <= final.amountMinor) return { ...compareAt, amountMinor: 0n };
  const savings = subtractMoney(compareAt, final);
  return savings.ok ? savings.value : null;
}

function minOf(left: Money, right: Money) {
  return left.amountMinor <= right.amountMinor ? left : right;
}

function mustSum(values: Money[], zero: Money) {
  return values.reduce<ReturnType<typeof addMoney>>((total, value) => {
    if (!total.ok) return total;
    return addMoney(total.value, value);
  }, { ok: true, value: zero });
}

function sameAdjustment(left: PricingConfig, right: PricingConfig) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function emptyQuote(zero: Money, freeShipping: boolean): DealQuote {
  return {
    currencyCode: zero.currencyCode,
    lines: [],
    regularTotal: zero,
    appliedDiscountTotal: zero,
    finalTotal: zero,
    discountSavings: zero,
    compareAt: { savings: null, coverage: "none" },
    freeShipping,
    maximumShippingRate: null,
  };
}

function fail(code: string, message: string): QuoteResult {
  return { ok: false, errors: [{ code, message }] };
}
