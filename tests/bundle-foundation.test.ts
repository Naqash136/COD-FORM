import assert from "node:assert/strict";
import fs from "node:fs";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const currencies = await vite.ssrLoadModule("/app/bundles/currencies.ts");
const money = await vite.ssrLoadModule("/app/bundles/money.ts");
const schema = await vite.ssrLoadModule("/app/bundles/schema.ts");
const validate = await vite.ssrLoadModule("/app/bundles/validate.ts");
const pricing = await vite.ssrLoadModule("/app/bundles/pricing.ts");
const revisions = await vite.ssrLoadModule("/app/bundles/revisions.ts");

function mustMoney(amountMinor: number, currencyCode: string) {
  const result = money.makeMoney(BigInt(amountMinor), currencyCode);
  assert.equal(result.ok, true);
  return result.value;
}

function variant(id: number, allowed: number[] = [id]) {
  return {
    productId: `gid://shopify/Product/${id}`,
    allowedVariantIds: allowed.map((value) => `gid://shopify/ProductVariant/${value}`),
    selectedVariantId: `gid://shopify/ProductVariant/${id}`,
  };
}

function barBase(id: string, selected = false) {
  return {
    id,
    title: `Bar ${id}`,
    subtitle: "",
    label: "",
    textTemplate: "{{product_title}} {{quantity}} {{regular_price}} {{compare_at_price}} {{final_price}} {{discount}} {{savings}} {{currency}}",
    selectedByDefault: selected,
    images: {
      customBarImage: { source: "url", url: "https://cdn.example.com/bar.png", alt: "Bar" },
      featuredImage: { source: "product", productId: "gid://shopify/Product/1", alt: null },
    },
    upsells: [],
    gifts: { selection: "single", items: [] },
    freeShipping: { enabled: false, maximumRate: null },
    personalisation: { enabled: false, perUnit: true, fields: [] },
    highlights: [{ id: "h1", text: "Popular", icon: { source: "file", fileId: "gid://shopify/MediaImage/9", alt: null } }],
    soldOut: { appearance: "show_unavailable", restrictSelection: true },
    extensions: null,
  };
}

function document(bars: unknown[], name = "Offer") {
  return {
    schemaVersion: 1,
    name,
    products: { items: [{ id: "catalog-1", product: variant(1) }] },
    settings: { extensions: null },
    style: { extensions: null },
    bars,
    modal: { extensions: null },
    targeting: { productIds: ["gid://shopify/Product/1"], collectionIds: [] },
    extensions: null,
  };
}

function book(prices: Record<number, number | null>, currency = "USD", unavailable: number[] = []) {
  const variants: Record<string, unknown> = {};
  for (const [id, amount] of Object.entries(prices)) {
    variants[`gid://shopify/ProductVariant/${id}`] = {
      regular: amount == null ? null : mustMoney(amount, currency),
      compareAt: null,
      available: !unavailable.includes(Number(id)),
    };
  }
  return { currencyCode: currency, variants };
}

function minor(result: { ok: boolean; quote?: { finalTotal: { amountMinor: bigint }; lines: Array<{ barId: string; finalLinePrice: { amountMinor: bigint } }> } }) {
  assert.equal(result.ok, true);
  return result.quote!;
}

assert.equal(currencies.currencyExponent("PKR"), 2);
assert.equal(currencies.currencyExponent("USD"), 2);
assert.equal(currencies.currencyExponent("JPY"), 0);
assert.equal(currencies.currencyExponent("KWD"), 3);
assert.equal(currencies.currencyExponent("XXX"), null);
assert.equal(new Set(currencies.shopifyCurrencyCodes).size, 162);

assert.equal(money.percentageOf(mustMoney(1, "USD"), 5000).value.amountMinor, 1n);
assert.equal(money.percentageOf(mustMoney(2, "USD"), 5000).value.amountMinor, 1n);
assert.equal(money.percentageOf(mustMoney(5, "USD"), 5000).value.amountMinor, 3n);
assert.equal(money.percentageOf(mustMoney(14, "USD"), 1000).value.amountMinor, 1n);
assert.equal(money.percentageOf(mustMoney(10050, "PKR"), 250).value.amountMinor, 251n);
assert.equal(money.percentageOf(mustMoney(101, "JPY"), 5000).value.amountMinor, 51n);
assert.equal(money.percentageOf(mustMoney(1505, "KWD"), 1000).value.amountMinor, 151n);
assert.equal(money.parseDecimal("10.0", "JPY").ok, true);
assert.equal(money.parseDecimal("10.5", "JPY").ok, false);
assert.equal(money.parseDecimal("100.501", "PKR").ok, false);
assert.equal(money.parseDecimal("-1.00", "USD").ok, false);

const quantityBar = {
  ...barBase("qty"),
  type: "quantity_break",
  pricing: { mode: "fixed_price", amount: { amountMinor: "300", currencyCode: "USD" }, scope: "per_group" },
  config: { product: variant(1), quantity: 4, quantitySelector: true },
};
const buyBar = {
  ...barBase("bxgy"),
  type: "buy_x_get_y",
  pricing: { mode: "full_price" },
  config: {
    product: variant(2),
    buyQuantity: 4,
    getQuantity: 2,
    getPricing: { mode: "fixed_price", amount: { amountMinor: "500", currencyCode: "USD" }, scope: "per_group" },
    getProduct: null,
  },
};
const mixBar = {
  ...barBase("mix", true),
  type: "mix_and_match",
  pricing: { mode: "full_price" },
  config: {
    showPrices: true,
    showOnlyWhenSelected: true,
    changeButtonLabel: "Change",
    selectionModal: { title: "Choose products" },
    slots: [
      { id: "slot-1", role: "default", title: "{{product}}", product: variant(11), swapProducts: [variant(21)], swapCollectionIds: ["gid://shopify/Collection/1"] },
      { id: "slot-2", role: "additional", title: "{{product}}", product: variant(12), swapProducts: [], swapCollectionIds: [] },
      { id: "slot-3", role: "additional", title: "{{product}}", product: variant(13), swapProducts: [], swapCollectionIds: [] },
      { id: "slot-4", role: "additional", title: "{{product}}", product: variant(14), swapProducts: [], swapCollectionIds: [] },
    ],
  },
};
const bundleBar = {
  ...barBase("bundle"),
  type: "product_bundle",
  config: {
    layout: "horizontal",
    hideIndividualPrice: true,
    showOnlyWhenSelected: true,
    products: [
      { id: "default", role: "default", product: variant(31), quantity: 1, quantitySelector: false, pricing: { mode: "full_price" } },
      { id: "extra", role: "additional", product: variant(32), quantity: 1, quantitySelector: true, pricing: { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" } },
    ],
  },
};
const alternativeBar = {
  ...barBase("alt"),
  type: "alternative_product",
  pricing: { mode: "percentage_off", basisPoints: 1000, scope: "per_line" },
  config: { product: variant(41), quantity: 2 },
};

const offer = document([quantityBar, buyBar, mixBar, bundleBar, alternativeBar]);
const validated = validate.validateDocument(offer, "publish");
assert.equal(validated.ok, true);
assert.equal(validate.validateDocument(document([]), "draft").ok, true);
assert.equal(validate.validateDocument(document([]), "publish").ok, false);
assert.equal(validate.validateDocument({ ...offer, subscriptions: {} }, "draft").ok, false);
assert.equal(validate.validateDocument(document([{ ...quantityBar, config: { ...quantityBar.config, tiers: [] } }]), "draft").ok, false);
assert.equal(validate.validateDocument(document([{ ...quantityBar, selectedByDefault: true }, { ...buyBar, selectedByDefault: true }]), "draft").ok, false);

const scaled = minor(pricing.quoteDocument(validated.document, { bars: [{ barId: "qty", quantity: 5 }] }, book({ 1: 1799 })));
assert.equal(scaled.finalTotal.amountMinor, 375n);
assert.equal(scaled.lines.length, 1);

const buyQuote = minor(pricing.quoteDocument(validated.document, { bars: [{ barId: "bxgy" }] }, book({ 2: 1799 })));
assert.equal(buyQuote.finalTotal.amountMinor, 7696n);

const mixPrices = book({ 11: 1799, 12: 1799, 13: 4699, 14: 1699, 21: 100 });
const mixFull = minor(pricing.quoteDocument(validated.document, { bars: [{ barId: "mix" }] }, mixPrices));
assert.equal(mixFull.finalTotal.amountMinor, 9996n);
assert.equal(mixFull.lines.some((line: { barId: string }) => line.barId === "qty"), false);

const amountDocument = validate.validateDocument(document([{
  ...mixBar,
  pricing: { mode: "amount_off", amount: { amountMinor: "1000", currencyCode: "USD" }, scope: "per_deal" },
}]), "publish");
assert.equal(amountDocument.ok, true);
const amountQuote = minor(pricing.quoteDocument(amountDocument.document, { bars: [{ barId: "mix" }] }, mixPrices));
assert.equal(amountQuote.finalTotal.amountMinor, 8996n);

const fixedDocument = validate.validateDocument(document([{
  ...mixBar,
  pricing: { mode: "fixed_price", amount: { amountMinor: "5000", currencyCode: "USD" }, scope: "per_deal" },
}]), "publish");
assert.equal(fixedDocument.ok, true);
const beforeSwap = minor(pricing.quoteDocument(fixedDocument.document, { bars: [{ barId: "mix" }] }, mixPrices));
const afterSwap = minor(pricing.quoteDocument(fixedDocument.document, {
  bars: [{ barId: "mix", slots: [{ slotId: "slot-1", variantId: "gid://shopify/ProductVariant/21" }] }],
}, mixPrices));
assert.equal(beforeSwap.finalTotal.amountMinor, 5000n);
assert.equal(afterSwap.finalTotal.amountMinor, 5000n);
const allocated = afterSwap.lines.reduce((sum: bigint, line: { finalLinePrice: { amountMinor: bigint } }) => sum + line.finalLinePrice.amountMinor, 0n);
assert.equal(allocated, afterSwap.finalTotal.amountMinor);

const unknownCollectionSwap = pricing.quoteDocument(fixedDocument.document, {
  bars: [{ barId: "mix", slots: [{ slotId: "slot-1", variantId: "gid://shopify/ProductVariant/99" }] }],
}, mixPrices);
assert.equal(unknownCollectionSwap.ok, false);
assert.equal(unknownCollectionSwap.errors.some((error: { code: string }) => error.code === "unknown_swap"), true);

const soldOut = pricing.quoteDocument(validated.document, { bars: [{ barId: "qty" }] }, book({ 1: 1799 }, "USD", [1]));
assert.equal(soldOut.ok, false);
assert.equal(soldOut.errors.some((error: { code: string }) => error.code === "sold_out"), true);
const selectableSoldOut = validate.validateDocument(document([{
  ...quantityBar,
  soldOut: { appearance: "show_selectable", restrictSelection: false },
}]), "publish");
assert.equal(pricing.quoteDocument(selectableSoldOut.document, { bars: [{ barId: "qty" }] }, book({ 1: 1799 }, "USD", [1])).ok, false);

const missing = pricing.quoteDocument(validated.document, { bars: [{ barId: "qty" }] }, book({ 1: null }));
assert.equal(missing.ok, false);
assert.equal(missing.errors.some((error: { code: string }) => error.code === "missing_price"), true);

const compared = pricing.quoteLines([
  {
    lineId: "line-1",
    barId: "bar-1",
    role: "merchandise",
    quantity: 1,
    regularUnitPrice: mustMoney(1000, "USD"),
    compareAtUnitPrice: mustMoney(1500, "USD"),
    available: true,
    restrictWhenSoldOut: false,
    groupId: "group-1",
    adjustment: { mode: "percentage_off", basisPoints: 1000, scope: "per_line" },
  },
], "USD", false);
assert.equal(compared.ok, true);
assert.equal(compared.quote.discountSavings.amountMinor, 100n);
assert.equal(compared.quote.compareAt.savings.amountMinor, 600n);

const raised = pricing.quoteLines([
  {
    lineId: "line-1",
    barId: "bar-1",
    role: "merchandise",
    quantity: 1,
    regularUnitPrice: mustMoney(100, "USD"),
    compareAtUnitPrice: null,
    available: true,
    restrictWhenSoldOut: false,
    groupId: "group-1",
    adjustment: { mode: "fixed_price", amount: { amountMinor: "500", currencyCode: "USD" }, scope: "per_group" },
  },
], "USD", false);
assert.equal(raised.ok, true);
assert.equal(raised.quote.finalTotal.amountMinor, 500n);
assert.equal(raised.quote.discountSavings.amountMinor, 0n);

const mixed = pricing.quoteLines([
  {
    lineId: "line-1",
    barId: "bar-1",
    role: "merchandise",
    quantity: 1,
    regularUnitPrice: mustMoney(100, "PKR"),
    compareAtUnitPrice: null,
    available: true,
    restrictWhenSoldOut: false,
    groupId: "group-1",
    adjustment: { mode: "full_price" },
  },
], "USD", false);
assert.equal(mixed.ok, false);

const migration = fs.readFileSync("prisma/migrations/20261127100000_add_bundle_offers/migration.sql", "utf8");
const prismaSchema = fs.readFileSync("prisma/schema.prisma", "utf8");
assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
assert.match(migration, /REVOKE ALL ON TABLE "BundleOffer"/);
assert.match(migration, /ON DELETE CASCADE/);
assert.match(migration, /BundleRevision rows are immutable/);
assert.match(migration, /publishedRevisionId" IS NOT NULL/);
assert.match(migration, /bundle_offer_pointers_match/);
assert.doesNotMatch(migration, /ALTER TABLE "Shop"/);
assert.doesNotMatch(migration, /ALTER TABLE "Session"/);
assert.doesNotMatch(migration, /ALTER TABLE "LoginHistory"/);
assert.doesNotMatch(migration, /DROP TABLE/);
assert.match(prismaSchema, /model BundleOffer/);
assert.match(prismaSchema, /model BundleRevision/);
assert.match(prismaSchema, /model Shop/);
assert.match(prismaSchema, /model Session/);
assert.match(prismaSchema, /model LoginHistory/);
assert.match(schema.PRICING_RULES.quantityBreakFixed, /configured quantity/);
assert.match(schema.CONFIGURATION_AUTHORITY.productData, /Shopify/);
assert.match(schema.CONFIGURATION_AUTHORITY.barConfiguration, /allowed products/);
assert.match(schema.CONFIGURATION_AUTHORITY.variantSelection, /available/);
assert.match(schema.CONFIGURATION_AUTHORITY.collectionSwaps, /Shopify collection membership/);
assert.match(schema.CONFIGURATION_AUTHORITY.unavailableVariants, /regardless of sold-out styling/);
assert.match(schema.PRICING_RULES.productBundleAssumption, /assumption|own price/i);

const pointers = {
  id: "offer-1",
  shopId: "shop-1",
  name: "Offer",
  status: "DRAFT",
  draftRevisionId: "draft-rev",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
};
const savePlan = revisions.planSaveDraft(pointers, validated.document, "next-rev");
assert.deepEqual(Object.keys(savePlan.offerUpdate).sort(), ["draftRevisionId", "name"]);
assert.equal(revisions.planSaveDraft(pointers, validated.document, "draft-rev").code, "revision_reused");
const publishPlan = revisions.planPublish(pointers, { id: "next-rev", offerId: "offer-1", shopId: "shop-1" });
assert.deepEqual(publishPlan.offerUpdate, { publishedRevisionId: "next-rev", status: "PUBLISHED" });
assert.deepEqual(revisions.planDeactivate(), { status: "INACTIVE", storefrontActive: false, codFormActive: false });
assert.equal(revisions.saveDraftGuard(pointers, "draft-rev").draftRevisionId, "draft-rev");
assert.equal(revisions.saveDraftGuard(pointers, "draft-rev").shopId, "shop-1");

await vite.close();
console.log(JSON.stringify({ ok: true, currencies: currencies.shopifyCurrencyCodes.length }));
