import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const databaseUrl = process.env.COD_FORM_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COD_FORM_TEST_DATABASE_URL is required. Bundle editor tests cannot be skipped.");
}

const host = new URL(databaseUrl).hostname;
if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
  throw new Error("Refusing to run bundle editor tests against a non-local database.");
}

try {
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    stdio: "pipe",
    encoding: "utf8",
  });
} catch (error) {
  const detail = error instanceof Error ? error.message : "Migration failed";
  throw new Error(detail.replace(/postgres(?:ql)?:\/\/\S+/gi, "[database]"));
}

const { PrismaClient } = await import("@prisma/client");
const { createElement } = await import("react");
const { renderToString } = await import("react-dom/server");
const { createMemoryRouter, RouterProvider } = await import("react-router");
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const vite = await createServer({
  server: { middlewareMode: true, watch: null },
  appType: "custom",
  logLevel: "error",
});

const editor = await vite.ssrLoadModule("/app/bundles/editor-state.ts");
const images = await vite.ssrLoadModule("/app/bundles/images.ts");
const persistence = await vite.ssrLoadModule("/app/bundles/editor.server.ts");
const validation = await vite.ssrLoadModule("/app/bundles/validate.ts");
const text = await vite.ssrLoadModule("/app/bundles/text.ts");
const edits = await vite.ssrLoadModule("/app/bundles/bar-edit.ts");
const soldOut = await vite.ssrLoadModule("/app/bundles/sold-out.ts");
const pricing = await vite.ssrLoadModule("/app/bundles/pricing.ts");
const view = await vite.ssrLoadModule("/app/components/bundle-editor.tsx");

const productId = "gid://shopify/Product/1";
const variantId = "gid://shopify/ProductVariant/1";
const previewProduct = {
  id: productId,
  title: "Loaded product",
  status: "ACTIVE",
  featuredImageUrl: null,
  featuredImageAlt: null,
  variantsComplete: true,
  variants: [{
    id: variantId,
    title: "Default",
    availableForSale: true,
    regularLabel: null,
    compareLabel: null,
  }],
};

function assertOk<T extends { ok: boolean }>(result: T): asserts result is Extract<T, { ok: true }> {
  assert.equal(result.ok, true);
}

const initial = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: editor.emptyDocument(),
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "PK",
});

const renamed = editor.editorReducer(initial, { type: "rename", name: "Weekend offer" });
assert.equal(editor.isDirty(renamed), true);
assert.equal(editor.isDirty(initial), false);

const previewChanged = editor.editorReducer(renamed, { type: "selectPreviewCountry", countryCode: "GB" });
assert.equal(previewChanged.document, renamed.document);
assert.equal(previewChanged.previewCountry, "GB");

const chosen = editor.editorReducer(previewChanged, { type: "selectPreviewProduct", productId });
const requested = editor.editorReducer(chosen, { type: "catalogRequested", token: "current" });
const stale = editor.editorReducer(requested, {
  type: "catalogReceived",
  token: "old",
  products: [previewProduct],
  priceBook: null,
  message: "stale",
});
assert.equal(stale.previewProduct, null);
const fresh = editor.editorReducer(requested, {
  type: "catalogReceived",
  token: "current",
  products: [previewProduct],
  priceBook: null,
  message: null,
});
assert.equal(fresh.previewProduct.title, "Loaded product");
assert.equal(editor.isDirty(fresh), true);
assert.equal(JSON.stringify(fresh.document), JSON.stringify(renamed.document));

const createdBar = editor.createBar("quantity_break", previewProduct, "barqty1");
assertOk(createdBar);
assert.equal(createdBar.bar.selectedByDefault, false);
const withBar = editor.editorReducer(fresh, { type: "addBar", bar: createdBar.bar });
const selected = editor.editorReducer(withBar, { type: "selectPreviewBar", barId: createdBar.bar.id });
assert.equal(selected.document.bars[0].selectedByDefault, false);
assert.equal(JSON.stringify(selected.savedDocument), JSON.stringify(initial.document));

for (const item of editor.BAR_MENU) {
  const bar = editor.createBar(item.type, previewProduct, `bar${item.type}`.slice(0, 20));
  assertOk(bar);
  const validated = validation.validateDocument({ ...editor.emptyDocument("Offer"), bars: [bar.bar] }, "draft");
  assert.equal(validated.ok, true, item.type);
}

assert.equal(editor.createBar("quantity_break", { ...previewProduct, variantsComplete: false }, "barpartial").ok, false);
assert.equal(editor.createBar("quantity_break", { ...previewProduct, status: "DRAFT" }, "barsold").ok, false);
const picked = editor.catalogFromPicker([{ id: productId, title: "Loaded product", variants: [] }]);
assert.equal(picked.ok, false);

const quote = editor.previewOffer(withBar.document, createdBar.bar.id, {
  currencyCode: "USD",
  variants: {
    [variantId]: {
      available: true,
      regular: { amountMinor: "1440", currencyCode: "USD", exponent: 2 },
      compareAt: null,
    },
  },
});
assert.equal(quote.ok, true);
assert.equal(quote.final, "14.40");
assert.equal(quote.currency, "USD");
assert.equal(editor.previewOffer(withBar.document, null, null).ok, false);

const book = {
  currencyCode: "USD",
  variants: {
    [variantId]: {
      available: true,
      regular: { amountMinor: "1440", currencyCode: "USD", exponent: 2 },
      compareAt: null,
    },
  },
};
const defaultDocument = {
  ...editor.emptyDocument("Offer"),
  bars: [{
    ...createdBar.bar,
    selectedByDefault: true,
    title: "Buy {{quantity}}",
    textTemplate: "{{product}} saves {{saved_amount}} ({{saved_percentage}})",
  }],
};
const loadedDefault = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: defaultDocument,
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
assert.equal(loadedDefault.previewBarId, createdBar.bar.id);
const previewClick = editor.editorReducer(loadedDefault, { type: "selectPreviewBar", barId: null });
assert.equal(previewClick.document.bars[0].selectedByDefault, true);
assert.equal(previewClick.previewTouched, true);

const copied = editor.editorReducer(loadedDefault, { type: "duplicateBar", barId: createdBar.bar.id, id: "barcopy1" });
assert.equal(copied.document.bars[1].id, "barcopy1");
assert.equal(copied.document.bars[1].selectedByDefault, false);
assert.equal(copied.document.bars[0].selectedByDefault, true);
assert.equal(copied.document.bars[1].pricing.mode, copied.document.bars[0].pricing.mode);
const moved = editor.editorReducer(copied, { type: "reorderBars", from: 1, to: 0 });
assert.equal(moved.document.bars[0].id, "barcopy1");
assert.equal(moved.document.bars[1].title, copied.document.bars[0].title);
const removed = editor.editorReducer(previewClick, { type: "deleteBar", barId: createdBar.bar.id });
assert.equal(removed.previewBarId, null);
assert.equal(removed.document.bars.length, 0);

const alternative = editor.createBar("alternative_product", previewProduct, "baralt1");
assertOk(alternative);
assert.equal(alternative.bar.title, "{{product}}");
assert.equal(alternative.bar.config.quantity, 1);
const twoBars = editor.editorReducer(withBar, { type: "addBar", bar: { ...alternative.bar, selectedByDefault: true } });
const exclusive = editor.editorReducer(twoBars, { type: "replaceBar", bar: { ...twoBars.document.bars[0], selectedByDefault: true } });
assert.equal(exclusive.document.bars.filter((bar: { selectedByDefault: boolean }) => bar.selectedByDefault).length, 1);

const cards = editor.previewBarCards(defaultDocument, book, { [productId]: "Loaded product" });
assert.equal(cards[0].title, "Buy 1");
assert.equal(cards[0].text, "Loaded product saves 0.00 USD (0%)");
assert.equal(text.resolveTemplate("{{unknown_token}}", {}), "{{unknown_token}}");
assert.equal(edits.basisPointsFromPercent("12.34"), 1234);
assert.equal(edits.basisPointsFromPercent("101"), null);
assert.equal(edits.storedAmount("14.40", "USD")?.amountMinor, "1440");
assert.equal(edits.storedAmount("-1", "USD"), null);
const lockedBar = soldOut.withSoldOutState(defaultDocument.bars[0], true, true);
assert.equal(soldOut.barSelectable(lockedBar), false);
assert.equal(editor.previewBarCards({ ...defaultDocument, bars: [lockedBar] }, book, { [productId]: "Loaded product" })[0].selectable, false);
const lockedState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...defaultDocument, bars: [lockedBar] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
assert.equal(lockedState.previewBarId, null);
assert.equal(editor.editorReducer(lockedState, { type: "selectPreviewBar", barId: lockedBar.id }), lockedState);

const variantTwo = "gid://shopify/ProductVariant/2";
const variantThree = "gid://shopify/ProductVariant/3";
function usd(amountMinor: string) {
  return { amountMinor, currencyCode: "USD", exponent: 2 };
}
function priceBook(variants: Record<string, { available: boolean; regular: ReturnType<typeof usd>; compareAt: ReturnType<typeof usd> | null }>) {
  return { currencyCode: "USD", variants };
}
function quantityOffer(id: string, config: { quantity: number; quantitySelector: boolean }, pricingMode: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }) {
  return {
    ...createdBar.bar,
    id,
    pricing: pricingMode,
    config: {
      ...createdBar.bar.config,
      product: {
        ...createdBar.bar.config.product,
        allowedVariantIds: [variantId, variantTwo, variantThree],
      },
      ...config,
    },
  };
}
const regularBook = priceBook({
  [variantId]: { available: true, regular: usd("1799"), compareAt: null },
  [variantTwo]: { available: true, regular: usd("1999"), compareAt: null },
  [variantThree]: { available: false, regular: usd("1799"), compareAt: null },
});
const comparedBook = priceBook({
  [variantId]: { available: true, regular: usd("1799"), compareAt: usd("2500") },
});
const regularBar = quantityOffer("bar-regular", { quantity: 1, quantitySelector: true }, { mode: "full_price" });
const quantityTotals: Array<[number, string]> = [[1, "17.99"], [2, "35.98"], [4, "71.96"]];
for (const [quantity, total] of quantityTotals) {
  const card = editor.previewBarCards(
    { ...editor.emptyDocument("Offer"), bars: [regularBar] },
    regularBook,
    { [productId]: "Loaded product" },
    { "bar-regular": { quantity } },
  )[0];
  assert.equal(card.price.final, total, `quantity ${quantity}`);
}
const percentBar = quantityOffer("bar-percent", { quantity: 1, quantitySelector: false }, { mode: "percentage_off", basisPoints: 1500, scope: "per_line" });
percentBar.title = "{{saved_amount}}";
percentBar.subtitle = "{{saved_percentage}}";
percentBar.textTemplate = "{{discount}}";
const percentCards = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [percentBar] }, comparedBook, { [productId]: "Loaded product" });
assert.equal(percentCards[0].price.final, "15.29");
assert.equal(percentCards[0].price.savings, "9.71");
assert.equal(percentCards[0].price.savedPercentage, "38.84%");
assert.equal(percentCards[0].title, "9.71 USD");
assert.equal(percentCards[0].subtitle, "38.84%");
assert.equal(percentCards[0].text, "2.70 USD");
const percentQuote = pricing.quoteDocument({ ...editor.emptyDocument("Offer"), bars: [percentBar] }, { bars: [{ barId: "bar-percent" }] }, {
  currencyCode: "USD",
  variants: { [variantId]: { available: true, regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } } },
});
assert.equal(percentQuote.ok, true);
assert.equal(percentQuote.quote.discountSavings.amountMinor, 270n);
assert.equal(percentQuote.quote.compareAt.savings.amountMinor, 971n);
assert.equal(percentQuote.quote.discountSavings.amountMinor + percentQuote.quote.compareAt.savings.amountMinor !== 971n, true);
const amountBar = quantityOffer("bar-amount", { quantity: 2, quantitySelector: false }, { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" });
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [amountBar] }, regularBook, {})[0].price.final, "33.98");
const fixedBar = quantityOffer("bar-fixed", { quantity: 4, quantitySelector: true }, { mode: "fixed_price", amount: { amountMinor: "300", currencyCode: "USD" }, scope: "per_group" });
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [fixedBar] }, regularBook, {}, { "bar-fixed": { quantity: 5 } })[0].price.final, "3.75");
const lockedQuantity = quantityOffer("bar-locked", { quantity: 4, quantitySelector: false }, { mode: "fixed_price", amount: { amountMinor: "300", currencyCode: "USD" }, scope: "per_group" });
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [lockedQuantity] }, regularBook, {}, { "bar-locked": { quantity: 5 } })[0].price.final, "3.00");
const secondBar = quantityOffer("bar-second", { quantity: 1, quantitySelector: true }, { mode: "full_price" });
const pair = editor.previewBarCards(
  { ...editor.emptyDocument("Offer"), bars: [regularBar, secondBar] },
  regularBook,
  {},
  { "bar-regular": { quantity: 2 } },
);
assert.equal(pair[0].price.final, "35.98");
assert.equal(pair[1].price.final, "17.99");
const variantCard = editor.previewBarCards(
  { ...editor.emptyDocument("Offer"), bars: [regularBar] },
  regularBook,
  {},
  { "bar-regular": { variantId: variantTwo } },
)[0];
assert.equal(variantCard.price.final, "19.99");
const previewState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...editor.emptyDocument("Offer"), bars: [regularBar, secondBar] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
const withBook = { ...previewState, priceBook: regularBook };
const adjusted = editor.editorReducer(withBook, { type: "setPreviewQuantity", barId: "bar-regular", quantity: 2 });
assert.equal(adjusted.previewQuantities["bar-regular"], 2);
assert.equal(editor.isDirty(adjusted), false);
assert.equal(JSON.stringify(adjusted.document), JSON.stringify(withBook.document));
assert.equal(editor.editorReducer(adjusted, { type: "setPreviewQuantity", barId: "bar-regular", quantity: 0 }), adjusted);
assert.equal(editor.editorReducer(adjusted, { type: "setPreviewQuantity", barId: "bar-regular", quantity: 1.5 }), adjusted);
assert.equal(editor.editorReducer(adjusted, { type: "setPreviewVariant", barId: "bar-regular", variantId: variantTwo }).previewVariants["bar-regular"], variantTwo);
assert.equal(editor.editorReducer(adjusted, { type: "setPreviewVariant", barId: "bar-regular", variantId: "gid://shopify/ProductVariant/9" }), adjusted);
assert.equal(editor.editorReducer(adjusted, { type: "setPreviewVariant", barId: "bar-regular", variantId: variantThree }), adjusted);
const switched = editor.editorReducer(adjusted, { type: "selectPreviewBar", barId: "bar-second" });
assert.equal(switched.previewQuantities["bar-regular"], 2);
assert.equal(switched.document.bars[0].config.quantity, 1);

const bxgyCreated = editor.createBar("buy_x_get_y", previewProduct, "bar-bxgy");
assertOk(bxgyCreated);
const freeGet = { mode: "percentage_off", basisPoints: 10000, scope: "per_line" };
function bxgyOffer(buyQuantity: number, getQuantity: number, buyPricing: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }, getPricing: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }) {
  return {
    ...bxgyCreated.bar,
    title: "Buy {{buy_quantity}} get {{get_quantity}}",
    subtitle: "{{quantity}}",
    textTemplate: "{{saved_amount}} {{discount}}",
    pricing: buyPricing,
    config: {
      ...bxgyCreated.bar.config,
      product: { ...bxgyCreated.bar.config.product, allowedVariantIds: [variantId, variantTwo, variantThree] },
      buyQuantity,
      getQuantity,
      getPricing,
      getProduct: null,
    },
  };
}
function bxgyCard(bar: ReturnType<typeof bxgyOffer>, choices: Record<string, { variantId?: string }> = {}) {
  return editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [bar] }, comparedBook, { [productId]: "Loaded product" }, choices)[0];
}
const oneFree = bxgyOffer(1, 1, { mode: "full_price" }, freeGet);
assert.equal(bxgyCard(oneFree).price.final, "17.99");
assert.equal(bxgyCard(oneFree).price.compareAt, "50.00 USD");
assert.equal(bxgyCard(oneFree).price.savings, "32.01");
assert.equal(bxgyCard(oneFree).title, "Buy 1 get 1");
assert.equal(bxgyCard(oneFree).subtitle, "2");
assert.equal(bxgyCard(bxgyOffer(2, 1, { mode: "full_price" }, freeGet)).price.final, "35.98");
assert.equal(bxgyCard(bxgyOffer(2, 2, { mode: "full_price" }, freeGet)).price.final, "35.98");
assert.equal(bxgyCard(bxgyOffer(2, 1, { mode: "full_price" }, { mode: "percentage_off", basisPoints: 5000, scope: "per_line" })).price.final, "44.97");
assert.equal(bxgyCard(bxgyOffer(4, 2, { mode: "full_price" }, { mode: "fixed_price", amount: { amountMinor: "500", currencyCode: "USD" }, scope: "per_group" })).price.final, "76.96");
assert.equal(bxgyCard(bxgyOffer(2, 1, { mode: "percentage_off", basisPoints: 1000, scope: "per_line" }, freeGet)).price.final, "32.38");
assert.equal(bxgyCard(bxgyOffer(2, 1, { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" }, freeGet)).price.final, "33.98");
assert.equal(bxgyCard(bxgyOffer(1, 1, { mode: "full_price" }, { mode: "fixed_price", amount: { amountMinor: "0", currencyCode: "USD" }, scope: "per_group" })).price.final, "17.99");
const freeQuote = pricing.quoteDocument({ ...editor.emptyDocument("Offer"), bars: [oneFree] }, { bars: [{ barId: "bar-bxgy" }] }, {
  currencyCode: "USD",
  variants: { [variantId]: { available: true, regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } } },
});
assert.equal(freeQuote.ok, true);
assert.equal(freeQuote.quote.finalTotal.amountMinor, 1799n);
assert.equal(freeQuote.quote.discountSavings.amountMinor, 1799n);
assert.equal(freeQuote.quote.compareAt.savings.amountMinor, 3201n);
assert.equal(freeQuote.quote.finalTotal.amountMinor >= 0n, true);
assert.equal(bxgyCard(oneFree).text, "32.01 USD 17.99 USD");
const invalidQuantity = validation.validateDocument({ ...editor.emptyDocument("Offer"), bars: [bxgyOffer(0, 1, { mode: "full_price" }, freeGet)] }, "draft");
assert.equal(invalidQuantity.ok, false);
const invalidDiscount = validation.validateDocument({
  ...editor.emptyDocument("Offer"),
  bars: [bxgyOffer(1, 1, { mode: "full_price" }, { mode: "percentage_off", basisPoints: 10001, scope: "per_line" })],
}, "draft");
assert.equal(invalidDiscount.ok, false);
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [oneFree] }, regularBook, { [productId]: "Loaded product" }, { "bar-bxgy": { variantId: variantTwo } })[0].price.final, "19.99");
const bxgyState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...editor.emptyDocument("Offer"), bars: [oneFree, regularBar] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
const bxgyPreview = editor.editorReducer({ ...bxgyState, priceBook: regularBook }, { type: "setPreviewVariant", barId: "bar-bxgy", variantId: variantTwo });
assert.equal(editor.isDirty(bxgyPreview), false);
assert.equal(bxgyPreview.document.bars[0].config.product.selectedVariantId, variantId);
assert.equal(bxgyPreview.previewVariants["bar-regular"], undefined);
assert.equal(editor.editorReducer(bxgyPreview, { type: "setPreviewVariant", barId: "bar-bxgy", variantId: variantThree }), bxgyPreview);

const bundleCreated = editor.createBar("product_bundle", previewProduct, "bar-bundle");
assertOk(bundleCreated);
const productB = "gid://shopify/Product/2";
const productC = "gid://shopify/Product/3";
const variantA2 = "gid://shopify/ProductVariant/11";
const variantB = "gid://shopify/ProductVariant/21";
const variantC = "gid://shopify/ProductVariant/31";
const full = { mode: "full_price" };
function bundleRow(id: string, product: string, variants: string[], selected: string, quantity: number, pricing: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }, role: "default" | "additional" = "additional", quantitySelector = false) {
  return {
    id,
    role,
    product: { productId: product, allowedVariantIds: variants, selectedVariantId: selected },
    quantity,
    quantitySelector,
    pricing,
  };
}
const rowA = bundleRow("row-a", productId, [variantId, variantA2], variantId, 1, full, "default");
const rowB = bundleRow("row-b", productB, [variantB], variantB, 1, full);
const rowC = bundleRow("row-c", productC, [variantC], variantC, 1, full);
function bundleOffer(products: Array<ReturnType<typeof bundleRow>>, layout: "vertical" | "horizontal" = "vertical", hideIndividualPrice = false, showOnlyWhenSelected = false) {
  return {
    ...bundleCreated.bar,
    title: "Bundle {{quantity}}",
    config: { layout, hideIndividualPrice, showOnlyWhenSelected, products },
  };
}
const bundleBook = priceBook({
  [variantId]: { available: true, regular: usd("1799"), compareAt: usd("2500") },
  [variantA2]: { available: true, regular: usd("1999"), compareAt: null },
  [variantB]: { available: true, regular: usd("4699"), compareAt: usd("5900") },
  [variantC]: { available: true, regular: usd("1699"), compareAt: usd("2500") },
});
const bundleCatalog = [
  { id: productId, title: "Product A", status: "ACTIVE", featuredImageUrl: "https://cdn.shopify.com/a.png", featuredImageAlt: "Product A", variantsComplete: true, variants: [
    { id: variantId, title: "Small", availableForSale: true, regularLabel: "17.99 USD", compareLabel: "25.00 USD" },
    { id: variantA2, title: "Large", availableForSale: true, regularLabel: "19.99 USD", compareLabel: null },
  ] },
  { id: productB, title: "Product B", status: "ACTIVE", featuredImageUrl: null, featuredImageAlt: null, variantsComplete: true, variants: [
    { id: variantB, title: "Default", availableForSale: true, regularLabel: "46.99 USD", compareLabel: "59.00 USD" },
  ] },
  { id: productC, title: "Product C", status: "ACTIVE", featuredImageUrl: null, featuredImageAlt: null, variantsComplete: true, variants: [
    { id: variantC, title: "Default", availableForSale: true, regularLabel: "16.99 USD", compareLabel: "25.00 USD" },
  ] },
];
const regularBundle = bundleOffer([rowA, rowB, rowC]);
const bundleCard = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, bundleBook, {}, {}, bundleCatalog)[0];
assert.equal(bundleCard.price.final, "81.97");
assert.equal(bundleCard.price.compareAt, "109.00 USD");
assert.equal(bundleCard.price.savings, "27.03");
assert.equal(bundleCard.products.map((product: { title: string; final: string }) => `${product.title}:${product.final}`).join(","), "Product A:17.99,Product B:46.99,Product C:16.99");
assert.equal(bundleCard.title, "Bundle 3");
const doubled = bundleOffer([bundleRow("row-a", productId, [variantId], variantId, 2, full, "default"), rowB, rowC]);
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [doubled] }, bundleBook, {}, {}, bundleCatalog)[0].price.final, "99.96");
const mixedPrices = bundleOffer([
  rowA,
  bundleRow("row-b", productB, [variantB], variantB, 1, { mode: "percentage_off", basisPoints: 2000, scope: "per_line" }),
  bundleRow("row-c", productC, [variantC], variantC, 1, { mode: "fixed_price", amount: { amountMinor: "1000", currencyCode: "USD" }, scope: "per_group" }),
]);
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [mixedPrices] }, bundleBook, {}, {}, bundleCatalog)[0].price.final, "65.58");
const amountBundle = bundleOffer([
  bundleRow("row-a", productId, [variantId], variantId, 2, { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" }, "default"),
  rowB,
  rowC,
]);
const amountCard = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [amountBundle] }, bundleBook, {}, {}, bundleCatalog)[0];
assert.equal(amountCard.products[0].final, "33.98");
assert.equal(amountCard.products[1].final, "46.99");
assert.equal(amountCard.price.final, "97.96");
const fixedBundle = bundleOffer([
  bundleRow("row-a", productId, [variantId], variantId, 2, { mode: "fixed_price", amount: { amountMinor: "1000", currencyCode: "USD" }, scope: "per_group" }, "default", true),
  rowB,
  rowC,
]);
const fixedCard = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [fixedBundle] }, bundleBook, {}, { "bar-bundle": { rows: { "row-a": { quantity: 4 } } } }, bundleCatalog)[0];
assert.equal(fixedCard.products[0].final, "20.00");
assert.equal(fixedCard.products[1].final, "46.99");
assert.equal(fixedCard.products[2].final, "16.99");
assert.equal(fixedCard.price.final, "83.98");
const variantBundleCard = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, bundleBook, {}, { "bar-bundle": { rows: { "row-a": { variantId: variantA2 } } } }, bundleCatalog)[0];
assert.equal(variantBundleCard.products[0].final, "19.99");
assert.equal(variantBundleCard.products[1].final, "46.99");
assert.equal(variantBundleCard.products[2].final, "16.99");
assert.equal(variantBundleCard.price.final, "83.97");
const reordered = edits.moveAdditionalProduct(regularBundle, "row-c", -1);
assert.equal(reordered.config.products.map((product: { id: string }) => product.id).join(","), "row-a,row-c,row-b");
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [reordered] }, bundleBook, {}, {}, bundleCatalog)[0].price.final, "81.97");
const removedProduct = edits.removeBundleProduct(regularBundle, "row-c");
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [removedProduct] }, bundleBook, {}, {}, bundleCatalog)[0].price.final, "64.98");
assert.equal(edits.removeBundleProduct(regularBundle, "row-a"), regularBundle);
const missingBook = priceBook({
  [variantId]: { available: true, regular: usd("1799"), compareAt: usd("2500") },
  [variantB]: { available: true, regular: usd("4699"), compareAt: usd("5900") },
});
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, missingBook, {}, {}, bundleCatalog)[0].price.ok, false);
const unavailableBook = priceBook({
  [variantId]: { available: true, regular: usd("1799"), compareAt: usd("2500") },
  [variantB]: { available: true, regular: usd("4699"), compareAt: usd("5900") },
  [variantC]: { available: false, regular: usd("1699"), compareAt: usd("2500") },
});
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, unavailableBook, {}, {}, bundleCatalog)[0].price.ok, false);
const mixedCurrency = pricing.quoteDocument({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, { bars: [{ barId: "bar-bundle" }] }, {
  currencyCode: "USD",
  variants: {
    [variantId]: { available: true, regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } },
    [variantB]: { available: true, regular: { amountMinor: 4699n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 5900n, currencyCode: "USD", exponent: 2 } },
    [variantC]: { available: true, regular: { amountMinor: 1699n, currencyCode: "EUR", exponent: 2 }, compareAt: null },
  },
});
assert.equal(mixedCurrency.ok, false);
const layoutCard = editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [bundleOffer([rowA, rowB, rowC], "horizontal", true, true)] }, bundleBook, {}, {}, bundleCatalog)[0];
assert.equal(layoutCard.layout, "horizontal");
assert.equal(layoutCard.hideIndividualPrice, true);
assert.equal(layoutCard.showOnlyWhenSelected, true);
assert.equal(layoutCard.price.final, "81.97");
const bundleQuote = pricing.quoteDocument({ ...editor.emptyDocument("Offer"), bars: [regularBundle] }, { bars: [{ barId: "bar-bundle" }] }, {
  currencyCode: "USD",
  variants: {
    [variantId]: { available: true, regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } },
    [variantB]: { available: true, regular: { amountMinor: 4699n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 5900n, currencyCode: "USD", exponent: 2 } },
    [variantC]: { available: true, regular: { amountMinor: 1699n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } },
  },
});
assert.equal(bundleQuote.ok, true);
assert.equal(bundleQuote.quote.discountSavings.amountMinor, 0n);
assert.equal(bundleQuote.quote.compareAt.savings.amountMinor, 2703n);
const invalidBundle = validation.validateDocument({ ...editor.emptyDocument("Offer"), bars: [bundleOffer([bundleRow("row-a", productId, [variantId], variantId, 0, full, "default")])] }, "draft");
assert.equal(invalidBundle.ok, false);
const invalidVariant = validation.validateDocument({
  ...editor.emptyDocument("Offer"),
  bars: [bundleOffer([bundleRow("row-a", productId, [variantId], variantA2, 1, full, "default")])],
}, "draft");
assert.equal(invalidVariant.ok, false);
const added = edits.addBundleProduct(bundleOffer([rowA]), { id: productB, title: "Product B", variants: [{ id: variantB, title: "Default" }] }, bundleCatalog);
assert.equal(added.ok, true);
const addedAgain = edits.addBundleProduct(added.bar, { id: productB, title: "Product B", variants: [{ id: variantB, title: "Default" }] }, bundleCatalog);
assert.equal(addedAgain.ok, true);
assert.notEqual(added.bar.config.products[1].id, addedAgain.bar.config.products[2].id);
assert.equal(edits.addBundleProduct(bundleOffer([rowA]), { id: productB, title: "Product B", variants: [{ id: variantB, title: "Default" }] }, [{ ...bundleCatalog[1], variantsComplete: false }]).ok, false);
const secondBundle = { ...bundleOffer([rowA]), id: "bar-second-bundle" };
const bundleState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...editor.emptyDocument("Offer"), bars: [regularBundle, secondBundle] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
const rowPreview = editor.editorReducer({ ...bundleState, priceBook: bundleBook }, { type: "setPreviewRowVariant", barId: "bar-bundle", rowId: "row-a", variantId: variantA2 });
assert.equal(editor.isDirty(rowPreview), false);
assert.equal(rowPreview.document.bars[0].config.products[0].product.selectedVariantId, variantId);
assert.equal(rowPreview.previewRows["bar-second-bundle:row-a"], undefined);
const copiedBundle = editor.editorReducer(rowPreview, { type: "duplicateBar", barId: "bar-bundle", id: "bar-bundle-copy" });
assert.notEqual(copiedBundle.document.bars[1].config.products[0].id, regularBundle.config.products[0].id);
assert.equal(copiedBundle.document.bars[0].config.products[0].id, "row-a");
assert.equal(editor.editorReducer(rowPreview, { type: "setPreviewRowQuantity", barId: "bar-bundle", rowId: "row-a", quantity: 4 }), rowPreview);

const mixCreated = editor.createBar("mix_and_match", previewProduct, "bar-mix");
assertOk(mixCreated);
assert.equal(mixCreated.bar.title, "Bundle & Save");
assert.equal(mixCreated.bar.subtitle, "Save {{saved_amount}}");
assert.equal(mixCreated.bar.pricing.mode, "percentage_off");
assert.equal(mixCreated.bar.pricing.basisPoints, 1500);
assert.equal(mixCreated.bar.pricing.scope, "per_deal");
assert.equal(mixCreated.bar.config.changeButtonLabel, "Change");
assert.equal(mixCreated.bar.config.selectionModal.title, "Select product");
assert.equal(mixCreated.bar.config.slots[0].title, "{{product}}");
assert.equal(mixCreated.bar.config.showPrices, true);

const productD = "gid://shopify/Product/4";
const mixA = "gid://shopify/ProductVariant/101";
const mixA2 = "gid://shopify/ProductVariant/102";
const mixB = "gid://shopify/ProductVariant/201";
const mixC = "gid://shopify/ProductVariant/301";
const mixD = "gid://shopify/ProductVariant/401";
const mixCollection = "gid://shopify/Collection/9";
function mixSlot(id: string, product: string, variant: string, role: "default" | "additional", swaps: Array<{ productId: string; variantId: string }> = [], collections: string[] = []) {
  return {
    id,
    role,
    title: "{{product}}",
    product: { productId: product, allowedVariantIds: variant === mixA ? [mixA, mixA2] : [variant], selectedVariantId: variant },
    swapProducts: swaps.map((swap) => ({ productId: swap.productId, allowedVariantIds: [swap.variantId], selectedVariantId: swap.variantId })),
    swapCollectionIds: collections,
  };
}
function mixOffer(pricingMode: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }, slots = [
  mixSlot("slot-a", productId, mixA, "default"),
  mixSlot("slot-b", productId, mixA, "additional", [{ productId: productB, variantId: mixB }]),
  mixSlot("slot-c", productC, mixC, "additional"),
  mixSlot("slot-d", productD, mixD, "additional"),
]) {
  return {
    ...mixCreated.bar,
    id: "bar-mix",
    pricing: pricingMode,
    config: { ...mixCreated.bar.config, slots },
  };
}
function minorBook(entries: Record<string, { regular: string; compareAt: string | null; available?: boolean }>) {
  return {
    currencyCode: "USD",
    variants: Object.fromEntries(Object.entries(entries).map(([id, point]) => [id, {
      available: point.available !== false,
      regular: { amountMinor: BigInt(point.regular), currencyCode: "USD", exponent: 2 },
      compareAt: point.compareAt == null ? null : { amountMinor: BigInt(point.compareAt), currencyCode: "USD", exponent: 2 },
    }])),
  };
}
const mixPrices = minorBook({
  [mixA]: { regular: "1799", compareAt: "3000" },
  [mixA2]: { regular: "1999", compareAt: null },
  [mixB]: { regular: "1999", compareAt: "3400" },
  [mixC]: { regular: "4699", compareAt: "5300" },
  [mixD]: { regular: "1699", compareAt: "2500" },
});
const fixedMix = mixOffer({ mode: "fixed_price", amount: { amountMinor: "5000", currencyCode: "USD" }, scope: "per_deal" });
const mixDocument = { ...editor.emptyDocument("Offer"), bars: [fixedMix] };
const beforeSwap = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, mixPrices);
assert.equal(beforeSwap.ok, true);
assert.equal(beforeSwap.quote.regularTotal.amountMinor, 9996n);
assert.equal(beforeSwap.quote.finalTotal.amountMinor, 5000n);
assert.equal(beforeSwap.quote.lines.map((line: { finalLinePrice: { amountMinor: bigint } }) => line.finalLinePrice.amountMinor).join(","), "900,900,2350,850");
assert.equal(beforeSwap.quote.compareAt.savings.amountMinor, 8800n);
assert.equal(beforeSwap.quote.lines.reduce((sum: bigint, line: { compareAtLinePrice: { amountMinor: bigint } | null }) => sum + (line.compareAtLinePrice?.amountMinor ?? 0n), 0n), 13800n);
assert.equal(beforeSwap.quote.discountSavings.amountMinor, 4996n);
const swapped = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-b", variantId: mixB }] }] }, mixPrices);
assert.equal(swapped.ok, true);
assert.equal(swapped.quote.regularTotal.amountMinor, 10196n);
assert.equal(swapped.quote.finalTotal.amountMinor, 5000n);
assert.equal(swapped.quote.lines.map((line: { finalLinePrice: { amountMinor: bigint } }) => line.finalLinePrice.amountMinor).join(","), "882,980,2305,833");
assert.equal(swapped.quote.lines.reduce((sum: bigint, line: { finalLinePrice: { amountMinor: bigint } }) => sum + line.finalLinePrice.amountMinor, 0n), 5000n);
assert.equal(swapped.quote.compareAt.savings.amountMinor, 9200n);
assert.equal(swapped.quote.lines.reduce((sum: bigint, line: { compareAtLinePrice: { amountMinor: bigint } | null }) => sum + (line.compareAtLinePrice?.amountMinor ?? 0n), 0n), 14200n);
const regularMix = mixOffer({ mode: "full_price" });
const regularSwapped = pricing.quoteDocument({ ...mixDocument, bars: [regularMix] }, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-b", variantId: mixB }] }] }, mixPrices);
assert.equal(regularSwapped.ok, true);
assert.equal(regularSwapped.quote.finalTotal.amountMinor, 10196n);
assert.equal(regularSwapped.quote.compareAt.savings.amountMinor, 4004n);
assert.equal(regularSwapped.quote.lines.reduce((sum: bigint, line: { compareAtLinePrice: { amountMinor: bigint } | null }) => sum + (line.compareAtLinePrice?.amountMinor ?? 0n), 0n), 14200n);
assert.equal(regularSwapped.quote.discountSavings.amountMinor, 0n);
const percentMix = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, mixPrices);
const percentDeal = pricing.quoteDocument({ ...mixDocument, bars: [mixOffer({ mode: "percentage_off", basisPoints: 1500, scope: "per_deal" })] }, { bars: [{ barId: "bar-mix" }] }, mixPrices);
assert.equal(percentDeal.ok, true);
assert.equal(percentDeal.quote.appliedDiscountTotal.amountMinor, 1499n);
assert.equal(percentDeal.quote.finalTotal.amountMinor, 8497n);
assert.equal(percentMix.ok, true);
const amountDeal = pricing.quoteDocument({ ...mixDocument, bars: [mixOffer({ mode: "amount_off", amount: { amountMinor: "1000", currencyCode: "USD" }, scope: "per_deal" })] }, { bars: [{ barId: "bar-mix" }] }, mixPrices);
assert.equal(amountDeal.ok, true);
assert.equal(amountDeal.quote.finalTotal.amountMinor, 8996n);
assert.equal(amountDeal.quote.appliedDiscountTotal.amountMinor, 1000n);
const variantMix = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-a", variantId: mixA2 }] }] }, mixPrices);
assert.equal(variantMix.ok, true);
assert.equal(variantMix.quote.finalTotal.amountMinor, 5000n);
assert.equal(variantMix.quote.lines[0].regularLinePrice.amountMinor, 1999n);
assert.equal(variantMix.quote.lines.map((line: { finalLinePrice: { amountMinor: bigint } }) => line.finalLinePrice.amountMinor).join(","), "980,882,2305,833");
assert.equal(pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-b", variantId: "gid://shopify/ProductVariant/999" }] }] }, mixPrices).ok, false);
const collectionSlot = mixSlot("slot-a", productId, mixA, "default", [], [mixCollection]);
const collectionDocument = { ...mixDocument, bars: [mixOffer({ mode: "full_price" }, [collectionSlot])] };
assert.equal(pricing.quoteDocument(collectionDocument, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-a", variantId: mixB }] }] }, mixPrices).ok, false);
const memberQuote = pricing.quoteDocument(collectionDocument, { bars: [{ barId: "bar-mix", slots: [{ slotId: "slot-a", variantId: mixB }] }] }, mixPrices, {
  memberships: [{ collectionId: mixCollection, productId: productB, variantIds: [mixB] }],
});
assert.equal(memberQuote.ok, true);
assert.equal(memberQuote.quote.finalTotal.amountMinor, 1999n);
const unavailableMix = minorBook({ [mixA]: { regular: "1799", compareAt: "3000", available: false }, [mixB]: { regular: "1999", compareAt: "3400" }, [mixC]: { regular: "4699", compareAt: "5300" }, [mixD]: { regular: "1699", compareAt: "2500" } });
assert.equal(pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, unavailableMix).ok, false);
const missingMix = minorBook({ [mixB]: { regular: "1999", compareAt: "3400" }, [mixC]: { regular: "4699", compareAt: "5300" }, [mixD]: { regular: "1699", compareAt: "2500" } });
assert.equal(pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, missingMix).ok, false);
const mixCurrencyBook = minorBook({ [mixA]: { regular: "1799", compareAt: "3000" }, [mixB]: { regular: "1999", compareAt: "3400" }, [mixC]: { regular: "4699", compareAt: "5300" }, [mixD]: { regular: "1699", compareAt: "2500" } });
mixCurrencyBook.variants[mixD].regular = { amountMinor: 1699n, currencyCode: "EUR", exponent: 2 };
assert.equal(pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, mixCurrencyBook).ok, false);
const partialCompare = minorBook({
  [mixA]: { regular: "1799", compareAt: "3000" },
  [mixA2]: { regular: "1999", compareAt: null },
  [mixB]: { regular: "1999", compareAt: "3400" },
  [mixC]: { regular: "4699", compareAt: "1000" },
  [mixD]: { regular: "1699", compareAt: null },
});
const partialQuote = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, partialCompare);
assert.equal(partialQuote.ok, true);
assert.equal(partialQuote.quote.compareAt.coverage, "partial");
assert.equal(partialQuote.quote.lines[2].compareAtLinePrice, null);
assert.equal(text.customerFacingSavings(partialQuote.quote).amount.amountMinor, partialQuote.quote.discountSavings.amountMinor);
assert.equal(text.customerFacingSavings(partialQuote.quote).amount.amountMinor, 4996n);
const equalCompare = minorBook({
  [mixA]: { regular: "1799", compareAt: "1799" },
  [mixA2]: { regular: "1999", compareAt: "1999" },
  [mixB]: { regular: "1999", compareAt: "1999" },
  [mixC]: { regular: "4699", compareAt: "4699" },
  [mixD]: { regular: "1699", compareAt: "1699" },
});
const equalQuote = pricing.quoteDocument(mixDocument, { bars: [{ barId: "bar-mix" }] }, equalCompare);
assert.equal(equalQuote.ok, true);
assert.equal(equalQuote.quote.compareAt.coverage, "none");
assert.equal(equalQuote.quote.lines.every((line: { compareAtLinePrice: unknown }) => line.compareAtLinePrice == null), true);
assert.equal(text.customerFacingSavings(equalQuote.quote).amount.amountMinor, 4996n);
for (const type of ["quantity_break", "buy_x_get_y", "product_bundle", "mix_and_match", "alternative_product"] as const) {
  const created = editor.createBar(type, previewProduct, `bar-${type}`);
  assert.equal(created.ok, true, type);
  const referenceDocument = { ...editor.emptyDocument("Reference"), bars: [created.bar] };
  const selection = { bars: [{ barId: created.bar.id }] };
  const referencePrices = (compareAt: bigint | null) => ({
    currencyCode: "USD",
    variants: {
      [variantId]: {
        available: true,
        regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 },
        compareAt: compareAt == null ? null : { amountMinor: compareAt, currencyCode: "USD", exponent: 2 },
      },
    },
  });
  const referenceJson = (compareAt: string | null) => priceBook({
    [variantId]: { available: true, regular: usd("1799"), compareAt: compareAt == null ? null : usd(compareAt) },
  });
  for (const compareAt of [1000n, 1799n, null] as const) {
    const quote = pricing.quoteDocument(referenceDocument, selection, referencePrices(compareAt));
    assert.equal(quote.ok, true, type);
    assert.equal(quote.quote.lines.every((line: { compareAtLinePrice: unknown }) => line.compareAtLinePrice == null), true, type);
    assert.notEqual(quote.quote.compareAt.coverage, "complete", type);
    const facing = text.customerFacingSavings(quote.quote);
    assert.equal(facing.amount.amountMinor, quote.quote.discountSavings.amountMinor, type);
    assert.equal(facing.reference.amountMinor, quote.quote.regularTotal.amountMinor, type);
  }
  const above = pricing.quoteDocument(referenceDocument, selection, referencePrices(2500n));
  assert.equal(above.ok, true, type);
  assert.equal(above.quote.compareAt.coverage, "complete", type);
  assert.equal(above.quote.lines.every((line: { compareAtLinePrice: unknown }) => line.compareAtLinePrice != null), true, type);
  const aboveFacing = text.customerFacingSavings(above.quote);
  assert.equal(aboveFacing.amount.amountMinor, above.quote.compareAt.savings.amountMinor, type);
  assert.equal(aboveFacing.amount.amountMinor === above.quote.discountSavings.amountMinor + above.quote.compareAt.savings.amountMinor, above.quote.discountSavings.amountMinor === 0n, type);
  const hidden = editor.previewBarCards(referenceDocument, referenceJson("1000"), {}, {}, [previewProduct])[0];
  const shown = editor.previewBarCards(referenceDocument, referenceJson("2500"), {}, {}, [previewProduct])[0];
  assert.equal(hidden.price.ok && hidden.price.compareAt, null, type);
  assert.equal(shown.price.ok && typeof shown.price.compareAt === "string", true, type);
  if (type === "quantity_break" || type === "buy_x_get_y") {
    assert.match(editor.compareAtNote(created.bar, referenceJson("1799")), /has not returned a compare-at price/);
    assert.match(editor.compareAtNote(created.bar, referenceJson("2500")), /25\.00 USD/);
  }
}
const mixPreviewBook = priceBook({
  [mixA]: { available: true, regular: usd("1799"), compareAt: usd("3000") },
  [mixA2]: { available: true, regular: usd("1999"), compareAt: null },
  [mixB]: { available: true, regular: usd("1999"), compareAt: usd("3400") },
  [mixC]: { available: true, regular: usd("4699"), compareAt: usd("5300") },
  [mixD]: { available: true, regular: usd("1699"), compareAt: usd("2500") },
});
const mixCatalog = [
  { id: productId, title: "Product A", status: "ACTIVE", featuredImageUrl: null, featuredImageAlt: null, variantsComplete: true, variants: [
    { id: mixA, title: "Small", availableForSale: true, regularLabel: "17.99 USD", compareLabel: "30.00 USD" },
    { id: mixA2, title: "Large", availableForSale: true, regularLabel: "19.99 USD", compareLabel: null },
  ] },
  { id: productB, title: "Product B", status: "ACTIVE", featuredImageUrl: null, featuredImageAlt: null, variantsComplete: true, variants: [
    { id: mixB, title: "Default", availableForSale: true, regularLabel: "19.99 USD", compareLabel: "34.00 USD" },
  ] },
];
const mixCard = editor.previewBarCards(mixDocument, mixPreviewBook, { [productId]: "Product A", [productB]: "Product B" }, { "bar-mix": { rows: { "slot-b": { variantId: mixB } } } }, mixCatalog)[0];
assert.equal(mixCard.price.final, "50.00");
assert.equal(mixCard.price.compareAt, "142.00 USD");
assert.equal(mixCard.price.savings, "92.00");
assert.equal(mixCard.products[1].title, "Product B");
assert.equal(mixCard.products[0].title, "Product A");
assert.equal(mixCard.products.map((product: { final: string }) => product.final).join(","), "8.82,9.80,23.05,8.33");
const hiddenPrices = { ...fixedMix, config: { ...fixedMix.config, showPrices: false, showOnlyWhenSelected: true } };
const hiddenCard = editor.previewBarCards({ ...mixDocument, bars: [hiddenPrices] }, mixPreviewBook, {}, {}, mixCatalog)[0];
assert.equal(hiddenCard.price.final, "50.00");
assert.equal(hiddenCard.hideIndividualPrice, true);
assert.equal(hiddenCard.showOnlyWhenSelected, true);
const movedSlots = edits.moveAdditionalSlot(fixedMix, "slot-d", -1);
assert.equal(movedSlots.config.slots.map((slot: { id: string }) => slot.id).join(","), "slot-a,slot-b,slot-d,slot-c");
assert.equal(pricing.quoteDocument({ ...mixDocument, bars: [movedSlots] }, { bars: [{ barId: "bar-mix" }] }, mixPrices).quote.finalTotal.amountMinor, 5000n);
assert.equal(edits.removeMixSlot(fixedMix, "slot-a"), fixedMix);
const removedSlot = edits.removeMixSlot(fixedMix, "slot-d");
assert.equal(pricing.quoteDocument({ ...mixDocument, bars: [removedSlot] }, { bars: [{ barId: "bar-mix" }] }, mixPrices).quote.finalTotal.amountMinor, 5000n);
assert.equal(pricing.quoteDocument({ ...mixDocument, bars: [removedSlot] }, { bars: [{ barId: "bar-mix" }] }, mixPrices).quote.lines.length, 3);
assert.equal(pricing.quoteDocument({ ...mixDocument, bars: [removedSlot] }, { bars: [{ barId: "bar-mix" }] }, mixPrices).quote.regularTotal.amountMinor, 8297n);
const duplicateSwap = edits.updateMixSlot(fixedMix, {
  ...fixedMix.config.slots[1],
  swapProducts: [
    { productId: productB, allowedVariantIds: [mixB], selectedVariantId: mixB },
    { productId: productB, allowedVariantIds: [mixB], selectedVariantId: mixB },
  ],
});
assert.equal(duplicateSwap.config.slots[1].swapProducts.length, 1);
const mixState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...mixDocument, bars: [fixedMix, { ...fixedMix, id: "bar-mix-two", selectedByDefault: false }] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
const mixPreview = editor.editorReducer({ ...mixState, priceBook: mixPreviewBook }, { type: "setPreviewRowVariant", barId: "bar-mix", rowId: "slot-b", variantId: mixB });
assert.equal(editor.isDirty(mixPreview), false);
assert.equal(mixPreview.document.bars[0].config.slots[1].product.selectedVariantId, mixA);
assert.equal(mixPreview.previewRows["bar-mix-two:slot-b"], undefined);
const removedAlternative = edits.updateMixSlot(fixedMix, { ...fixedMix.config.slots[1], swapProducts: [] });
const invalidated = editor.editorReducer({ ...mixPreview, document: { ...mixPreview.document, bars: [removedAlternative, mixPreview.document.bars[1]] } }, { type: "replaceBar", bar: removedAlternative });
assert.equal(invalidated.previewRows["bar-mix:slot-b"], undefined);
const copiedMix = editor.editorReducer(mixPreview, { type: "duplicateBar", barId: "bar-mix", id: "bar-mix-copy" });
assert.equal(copiedMix.document.bars[1].id, "bar-mix-copy");
assert.notEqual(copiedMix.document.bars[1].config.slots[0].id, fixedMix.config.slots[0].id);
assert.equal(copiedMix.document.bars[0].config.slots[0].id, "slot-a");

const spareId = "gid://shopify/Product/4";
const buy1 = "gid://shopify/ProductVariant/41";
const buy2 = "gid://shopify/ProductVariant/42";
const spareProduct = {
  id: spareId,
  title: "Spare",
  status: "ACTIVE",
  featuredImageUrl: "/fixtures/spare.png",
  featuredImageAlt: "Spare",
  variantsComplete: true,
  variants: [
    { id: buy1, title: "Buy 1", availableForSale: true, regularLabel: "24.50 USD", compareLabel: "39.00 USD" },
    { id: buy2, title: "Buy 2", availableForSale: true, regularLabel: "46.99 USD", compareLabel: "59.00 USD" },
  ],
};
const teeProduct = {
  ...previewProduct,
  title: "Tee",
  featuredImageUrl: "/fixtures/tee.png",
  featuredImageAlt: "Tee",
};
const spareKnown = [{
  id: spareId,
  variantsComplete: true,
  variants: [
    { id: buy1, availableForSale: true },
    { id: buy2, availableForSale: true },
  ],
}];
const altBook = priceBook({
  [buy1]: { available: true, regular: usd("2450"), compareAt: usd("3900") },
  [buy2]: { available: true, regular: usd("4699"), compareAt: usd("5900") },
});
const fullPrice = { mode: "full_price" };
function alternativeOffer(quantity: number, selectedVariantId: string, pricingMode: { mode: string; basisPoints?: number; scope?: string; amount?: { amountMinor: string; currencyCode: string } }) {
  return {
    ...alternative.bar,
    id: "bar-alt",
    title: "{{product}}",
    subtitle: "Save {{saved_amount}}",
    label: "Offer",
    selectedByDefault: false,
    pricing: pricingMode,
    config: {
      product: { productId: spareId, allowedVariantIds: [buy1, buy2], selectedVariantId },
      quantity,
    },
  };
}
function alternativeCard(bar: ReturnType<typeof alternativeOffer>, variantId?: string, book = altBook) {
  return editor.previewBarCards(
    { ...editor.emptyDocument("Offer"), bars: [bar] },
    book,
    { [spareId]: "Spare", [productId]: "Tee" },
    variantId ? { [bar.id]: { variantId } } : {},
    [spareProduct, teeProduct],
  )[0];
}
function alternativeQuote(bar: ReturnType<typeof alternativeOffer>, variantId?: string, variants: Record<string, { available: boolean; regular: { amountMinor: bigint; currencyCode: string; exponent: number } | null; compareAt: { amountMinor: bigint; currencyCode: string; exponent: number } | null }> = {
  [buy1]: { available: true, regular: { amountMinor: 2450n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 3900n, currencyCode: "USD", exponent: 2 } },
  [buy2]: { available: true, regular: { amountMinor: 4699n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 5900n, currencyCode: "USD", exponent: 2 } },
}) {
  return pricing.quoteDocument(
    { ...editor.emptyDocument("Offer"), bars: [bar] },
    { bars: [{ barId: bar.id, ...(variantId ? { variantId } : {}) }] },
    { currencyCode: "USD", variants },
  );
}
const oneBuy1 = alternativeCard(alternativeOffer(1, buy1, fullPrice));
assert.equal(oneBuy1.price.final, "24.50");
assert.equal(oneBuy1.price.compareAt, "39.00 USD");
assert.equal(oneBuy1.price.savings, "14.50");
assert.equal(oneBuy1.title, "Spare");
assert.equal(oneBuy1.subtitle, "Save 14.50 USD");
assert.equal(oneBuy1.label, "Offer");
assert.equal(oneBuy1.quantity, 1);
assert.equal(oneBuy1.quantitySelector, false);
assert.equal(oneBuy1.products.length, 0);
assert.equal(oneBuy1.variants.map((variant: { title: string }) => variant.title).join(","), "Buy 1,Buy 2");
const oneBuy2 = alternativeCard(alternativeOffer(1, buy1, fullPrice), buy2);
assert.equal(oneBuy2.price.final, "46.99");
assert.equal(oneBuy2.price.compareAt, "59.00 USD");
assert.equal(oneBuy2.price.savings, "12.01");
assert.equal(oneBuy2.quantity, 1);
assert.equal(oneBuy2.variantId, buy2);
const twoBuy1 = alternativeCard(alternativeOffer(2, buy1, fullPrice));
assert.equal(twoBuy1.price.final, "49.00");
assert.equal(twoBuy1.price.compareAt, "78.00 USD");
assert.equal(twoBuy1.price.savings, "29.00");
assert.equal(twoBuy1.quantity, 2);
const twoBuy2 = alternativeCard(alternativeOffer(2, buy1, fullPrice), buy2);
assert.equal(twoBuy2.price.final, "93.98");
assert.equal(twoBuy2.price.compareAt, "118.00 USD");
assert.equal(twoBuy2.price.savings, "24.02");
assert.equal(twoBuy2.quantity, 2);
const percentOffer = alternativeOffer(2, buy1, { mode: "percentage_off", basisPoints: 1000, scope: "per_line" });
const alternativePercentQuote = alternativeQuote(percentOffer);
assert.equal(alternativePercentQuote.ok, true);
assert.equal(alternativePercentQuote.quote.regularTotal.amountMinor, 4900n);
assert.equal(alternativePercentQuote.quote.appliedDiscountTotal.amountMinor, 490n);
assert.equal(alternativeCard(percentOffer).price.final, "44.10");
const amountOffer = alternativeOffer(2, buy1, { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" });
const amountQuote = alternativeQuote(amountOffer);
assert.equal(amountQuote.ok, true);
assert.equal(amountQuote.quote.appliedDiscountTotal.amountMinor, 200n);
assert.equal(alternativeCard(amountOffer).price.final, "47.00");
const fixedOffer = alternativeOffer(2, buy1, { mode: "fixed_price", amount: { amountMinor: "2000", currencyCode: "USD" }, scope: "per_group" });
assert.equal(alternativeCard(fixedOffer).price.final, "20.00");
const fixedAfterVariant = alternativeQuote(fixedOffer, buy2);
assert.equal(fixedAfterVariant.ok, true);
assert.equal(fixedAfterVariant.quote.regularTotal.amountMinor, 9398n);
assert.equal(fixedAfterVariant.quote.finalTotal.amountMinor, 2000n);
assert.equal(alternativeCard(fixedOffer, buy2).price.final, "20.00");
assert.equal(alternativeCard(fixedOffer, buy2).quantity, 2);
const alternativeEqualCompare = priceBook({
  [buy1]: { available: true, regular: usd("2450"), compareAt: usd("2450") },
  [buy2]: { available: true, regular: usd("4699"), compareAt: usd("1000") },
});
const invalidCompare = alternativeCard(alternativeOffer(1, buy1, fullPrice), undefined, alternativeEqualCompare);
assert.equal(invalidCompare.price.compareAt, null);
assert.equal(invalidCompare.price.savings, "0.00");
assert.equal(alternativeCard(alternativeOffer(1, buy2, fullPrice), buy2, alternativeEqualCompare).price.compareAt, null);
const percentWithoutCompare = alternativeCard(percentOffer, undefined, alternativeEqualCompare);
assert.equal(percentWithoutCompare.price.compareAt, null);
assert.equal(percentWithoutCompare.price.savings, "4.90");
assert.match(editor.compareAtNote(alternativeOffer(2, buy1, fullPrice), altBook), /39\.00 USD/);
assert.match(editor.compareAtNote(alternativeOffer(2, buy1, fullPrice), altBook), /configured quantity/);
assert.match(editor.compareAtNote(alternativeOffer(1, buy1, fullPrice), alternativeEqualCompare), /has not returned a compare-at price/);
const denied = alternativeQuote({
  ...alternativeOffer(1, buy1, fullPrice),
  config: { product: { productId: spareId, allowedVariantIds: [buy1], selectedVariantId: buy1 }, quantity: 1 },
}, buy2);
assert.equal(denied.ok, false);
const unavailableQuote = alternativeQuote(alternativeOffer(1, buy1, fullPrice), undefined, {
  [buy1]: { available: false, regular: { amountMinor: 2450n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 3900n, currencyCode: "USD", exponent: 2 } },
  [buy2]: { available: true, regular: { amountMinor: 4699n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 5900n, currencyCode: "USD", exponent: 2 } },
});
assert.equal(unavailableQuote.ok, false);
const missingPrice = editor.previewBarCards(
  { ...editor.emptyDocument("Offer"), bars: [alternativeOffer(1, buy1, fullPrice)] },
  { currencyCode: "USD", variants: { [buy1]: { available: true, regular: null, compareAt: null } } },
  { [spareId]: "Spare" },
  {},
  [spareProduct],
)[0];
assert.equal(missingPrice.price.ok, false);
const mixedAlternative = alternativeQuote(alternativeOffer(1, buy2, fullPrice), buy2, {
  [buy1]: { available: true, regular: { amountMinor: 2450n, currencyCode: "USD", exponent: 2 }, compareAt: null },
  [buy2]: { available: true, regular: { amountMinor: 4699n, currencyCode: "EUR", exponent: 2 }, compareAt: null },
});
assert.equal(mixedAlternative.ok, false);
const lockedAlternative = soldOut.withSoldOutState(alternativeOffer(1, buy1, fullPrice), true, true);
assert.equal(editor.previewBarCards({ ...editor.emptyDocument("Offer"), bars: [lockedAlternative] }, altBook, { [spareId]: "Spare" }, {}, [spareProduct])[0].selectable, false);
const lockedAlternativeState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: { ...editor.emptyDocument("Offer"), bars: [lockedAlternative] },
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
assert.equal(lockedAlternativeState.previewBarId, null);
assert.equal(editor.editorReducer(lockedAlternativeState, { type: "selectPreviewBar", barId: "bar-alt" }), lockedAlternativeState);
const secondAlternative = { ...alternativeOffer(1, buy1, fullPrice), id: "bar-alt-b" };
const independentCards = editor.previewBarCards(
  { ...editor.emptyDocument("Offer"), bars: [alternativeOffer(1, buy1, fullPrice), secondAlternative] },
  altBook,
  { [spareId]: "Spare" },
  { "bar-alt": { variantId: buy2 } },
  [spareProduct],
);
assert.equal(independentCards[0].price.final, "46.99");
assert.equal(independentCards[1].price.final, "24.50");
assert.equal(independentCards[0].quantity, 1);
assert.equal(independentCards[1].quantity, 1);
const emptyAllowed = edits.configureAlternativeProduct(alternativeOffer(1, buy1, fullPrice), {
  product: { productId: spareId, allowedVariantIds: [], selectedVariantId: buy1 },
  quantity: 1,
}, spareKnown);
assert.equal(emptyAllowed.ok, false);
const outsideDefault = edits.configureAlternativeProduct(alternativeOffer(1, buy1, fullPrice), {
  product: { productId: spareId, allowedVariantIds: [buy1], selectedVariantId: buy2 },
  quantity: 1,
}, spareKnown);
assert.equal(outsideDefault.ok, false);
const unavailableDefault = edits.configureAlternativeProduct(alternativeOffer(1, buy2, fullPrice), {
  product: { productId: spareId, allowedVariantIds: [buy2], selectedVariantId: buy2 },
  quantity: 1,
}, [{ id: spareId, variantsComplete: true, variants: [{ id: buy2, availableForSale: false }] }]);
assert.equal(unavailableDefault.ok, false);
assert.equal(edits.configureAlternativeProduct(alternativeOffer(1, buy1, fullPrice), {
  product: alternativeOffer(1, buy1, fullPrice).config.product,
  quantity: 0,
}, spareKnown).ok, false);
assert.equal(edits.configureAlternativeProduct(alternativeOffer(1, buy1, fullPrice), {
  product: alternativeOffer(1, buy1, fullPrice).config.product,
  quantity: 1000,
}, spareKnown).ok, false);
const maximumQuantity = edits.configureAlternativeProduct(alternativeOffer(1, buy1, fullPrice), {
  product: alternativeOffer(1, buy1, fullPrice).config.product,
  quantity: 999,
}, spareKnown);
assert.equal(maximumQuantity.ok, true);
assert.equal(maximumQuantity.bar.config.quantity, 999);
const incompletePick = edits.selectionFromPicker(
  { id: spareId, title: "Spare", variants: [{ id: buy1, title: "Buy 1" }] },
  [{ id: spareId, variantsComplete: false, variants: [] }],
);
assert.equal(incompletePick.ok, false);
const changedPick = edits.selectionFromPicker(
  { id: productId, title: "Tee", variants: [{ id: variantId, title: "Default" }] },
  [{ id: productId, variantsComplete: true, variants: [{ id: variantId, availableForSale: true }] }],
);
assert.equal(changedPick.ok, true);
const changedAlternative = edits.configureAlternativeProduct(alternativeOffer(2, buy2, fullPrice), {
  product: changedPick.selection,
  quantity: alternativeOffer(2, buy2, fullPrice).config.quantity,
}, [{ id: productId, variantsComplete: true, variants: [{ id: variantId, availableForSale: true }] }]);
assert.equal(changedAlternative.ok, true);
assert.equal(changedAlternative.bar.config.product.productId, productId);
assert.equal(changedAlternative.bar.config.product.selectedVariantId, variantId);
assert.equal(changedAlternative.bar.config.quantity, 2);
const galleryDocument = {
  ...editor.emptyDocument("Offer"),
  products: { items: [{ id: "p1", product: { productId, allowedVariantIds: [variantId], selectedVariantId: variantId } }] },
  bars: [alternativeOffer(1, buy1, fullPrice), secondAlternative],
};
const galleryState = editor.createEditorState({
  offerId: "offer-1",
  status: "DRAFT",
  document: galleryDocument,
  draftRevisionId: "revision-1",
  publishedRevisionId: null,
  storefrontActive: false,
  codFormActive: false,
  countryCode: "US",
});
const galleryLoaded = editor.editorReducer(galleryState, {
  type: "catalogReceived",
  token: "",
  products: [teeProduct, spareProduct],
  priceBook: altBook,
  message: null,
});
assert.equal(galleryLoaded.previewProduct.title, "Tee");
assert.equal(galleryLoaded.previewProduct.featuredImageUrl, "/fixtures/tee.png");
const galleryVariant = editor.editorReducer(galleryLoaded, { type: "setPreviewVariant", barId: "bar-alt", variantId: buy2 });
assert.equal(editor.isDirty(galleryVariant), false);
assert.equal(galleryVariant.previewProduct.title, "Tee");
assert.equal(galleryVariant.previewProduct.featuredImageUrl, "/fixtures/tee.png");
assert.equal(galleryVariant.document.bars[0].config.quantity, 1);
assert.equal(galleryVariant.previewVariants["bar-alt"], buy2);
const ignoredQuantity = editor.editorReducer(galleryVariant, { type: "setPreviewQuantity", barId: "bar-alt", quantity: 4 });
assert.equal(ignoredQuantity.previewQuantities["bar-alt"], undefined);
assert.equal(ignoredQuantity.document.bars[0].config.quantity, 1);
const disallowedPreview = editor.editorReducer(galleryVariant, { type: "setPreviewVariant", barId: "bar-alt", variantId: variantId });
assert.equal(disallowedPreview.previewVariants["bar-alt"], buy2);
const copiedAlternative = editor.editorReducer(galleryVariant, { type: "duplicateBar", barId: "bar-alt", id: "bar-alt-copy" });
assert.equal(copiedAlternative.previewVariants["bar-alt"], buy2);
assert.equal(copiedAlternative.previewVariants["bar-alt-copy"], undefined);
assert.equal(copiedAlternative.document.bars[1].config.product.productId, spareId);
assert.equal(copiedAlternative.document.bars[1].config.quantity, 1);
const copiedCards = editor.previewBarCards(
  copiedAlternative.document,
  altBook,
  { [spareId]: "Spare" },
  Object.fromEntries(Object.entries(copiedAlternative.previewVariants).map(([barId, variantId]) => [barId, { variantId }])),
  [spareProduct],
);
assert.equal(copiedCards[0].price.final, "46.99");
assert.equal(copiedCards[1].price.final, "24.50");
const replacedAlternative = editor.editorReducer(copiedAlternative, { type: "replaceBar", bar: changedAlternative.bar });
assert.equal(replacedAlternative.previewVariants["bar-alt"], undefined);
assert.equal(replacedAlternative.previewVariants["bar-alt-copy"], undefined);
assert.equal(replacedAlternative.previewProduct.title, "Tee");
assert.equal(replacedAlternative.document.bars[0].config.quantity, 2);
const requestedAlternative = editor.editorReducer(galleryVariant, { type: "catalogRequested", token: "fresh-alternative" });
const staleAlternative = editor.editorReducer(requestedAlternative, {
  type: "catalogReceived",
  token: "old-alternative",
  products: [],
  priceBook: null,
  message: "stale",
});
assert.equal(staleAlternative.previewVariants["bar-alt"], buy2);
assert.equal(staleAlternative.previewProduct.title, "Tee");
const unavailableCatalog = editor.editorReducer(galleryVariant, {
  type: "catalogReceived",
  token: "",
  products: [{
    ...spareProduct,
    variants: spareProduct.variants.map((variant: { id: string }) => ({ ...variant, availableForSale: variant.id !== buy2 })),
  }, teeProduct],
  priceBook: priceBook({
    [buy1]: { available: true, regular: usd("2450"), compareAt: usd("3900") },
    [buy2]: { available: false, regular: usd("4699"), compareAt: usd("5900") },
  }),
  message: null,
});
assert.equal(unavailableCatalog.previewVariants["bar-alt"], undefined);
assert.equal(unavailableCatalog.previewProduct.title, "Tee");

const imageCatalog = [
  { id: productId, title: "Tee", featuredImageUrl: "/fixtures/tee.png", featuredImageAlt: "Tee", images: [{ url: "/fixtures/tee.png", alt: "Tee" }], imagesComplete: true },
  { id: "gid://shopify/Product/3", title: "Cap", featuredImageUrl: "/fixtures/cap.png", featuredImageAlt: "Cap", images: [{ url: "/fixtures/cap.png", alt: "Cap" }], imagesComplete: true },
];
const imageBar = editor.createBar("quantity_break", previewProduct, "bar-image");
assertOk(imageBar);
assert.equal(imageBar.bar.images.barImageSize, 48);
assert.equal(imageBar.bar.images.barImageRadius, 6);
assert.equal(images.inspectImageUpload({ name: "mark.svg", type: "image/svg+xml", size: 20 }).code, "invalid_type");
assert.equal(images.inspectImageUpload({ name: "mark.png", type: "image/png", size: 5 * 1024 * 1024 + 1 }).code, "invalid_size");
assert.equal(images.inspectImageUpload({ name: "mark.png", type: "image/png", size: 1200 }).code, "ready_for_upload");
assert.equal(images.generateComposition(imageBar.bar, [{ id: productId, featuredImageUrl: null, featuredImageAlt: null, images: [], imagesComplete: true }]).ok, false);
const bundleImage = editor.createBar("product_bundle", { ...previewProduct, id: productId, featuredImageUrl: "/fixtures/tee.png", featuredImageAlt: "Tee" }, "bar-bundle-image");
assertOk(bundleImage);
if (bundleImage.bar.type === "product_bundle") {
  bundleImage.bar.config.products.push({
    ...bundleImage.bar.config.products[0],
    id: "row-cap",
    product: { productId: "gid://shopify/Product/3", allowedVariantIds: ["gid://shopify/ProductVariant/31"], selectedVariantId: "gid://shopify/ProductVariant/31" },
  });
}
const generated = images.generateComposition(bundleImage.bar, imageCatalog);
assert.equal(generated.ok, true);
assert.equal(generated.image.source, "composition");
assert.equal(generated.image.items.map((item: { url: string }) => item.url).join(","), "/fixtures/tee.png,/fixtures/cap.png");
const sized = images.applyBarImage(imageBar.bar, images.catalogImage(productId, "/fixtures/tee.png", "Tee"), 64, 8);
assert.equal(sized.ok, true);
assert.equal(images.catalogImage(productId, "blob:http://local/1", "Tee"), null);
const rejectedUpload = images.applyBarImage(imageBar.bar, { source: "url", url: "blob:http://local/1", alt: null }, 48, 6);
assert.equal(rejectedUpload.ok, false);
const featured = images.applyFeaturedImage(sized.bar, images.catalogImage("gid://shopify/Product/3", "/fixtures/cap.png", "Cap"));
assert.equal(featured.ok, true);
assert.equal(featured.bar.images.customBarImage.url, "/fixtures/tee.png");
assert.equal(featured.bar.images.featuredImage.url, "/fixtures/cap.png");
const copy = edits.duplicateBar(featured.bar, "bar-image-copy");
const clearedBarImage = images.applyBarImage(featured.bar, null, 48, 6);
assert.equal(clearedBarImage.ok, true);
assert.equal(clearedBarImage.bar.images.customBarImage, null);
assert.equal(clearedBarImage.bar.images.featuredImage.url, "/fixtures/cap.png");
assert.equal(copy.images.customBarImage.url, "/fixtures/tee.png");
const featuredRemoved = images.applyFeaturedImage(clearedBarImage.bar, null);
assert.equal(featuredRemoved.bar.images.featuredImage, null);
assert.equal(copy.images.featuredImage.url, "/fixtures/cap.png");
const galleryProduct = { title: "Tee", featuredImageUrl: "/fixtures/tee.png", featuredImageAlt: "Tee" };
assert.equal(images.previewGallery(galleryProduct, featured.bar, imageCatalog, true).mode, "featured");
assert.equal(images.previewGallery(galleryProduct, featured.bar, imageCatalog, true).url, "/fixtures/cap.png");
assert.equal(images.previewGallery(galleryProduct, featuredRemoved.bar, imageCatalog, true).mode, "original");
assert.equal(images.previewGallery(galleryProduct, featuredRemoved.bar, imageCatalog, true).url, "/fixtures/tee.png");
assert.equal(images.previewGallery(galleryProduct, null, imageCatalog, true).url, "/fixtures/tee.png");
const missingFeature = images.applyFeaturedImage(imageBar.bar, images.catalogImage(productId, "https://cdn.shopify.com/missing.png", "Missing"));
assert.equal(images.previewGallery(galleryProduct, missingFeature.bar, imageCatalog, true).mode, "restored");
assert.equal(images.resolveImage(missingFeature.bar.images.featuredImage, [{ ...imageCatalog[0], imagesComplete: false }], true).status, "single");
assert.equal(images.offerIndicator(featured.bar, imageCatalog, true).kind, "image");
assert.equal(images.offerIndicator(clearedBarImage.bar, imageCatalog, true).kind, "radio");
const imageState = editor.editorReducer(withBar, { type: "addBar", bar: featured.bar });
const imageSelected = editor.editorReducer(imageState, { type: "selectPreviewBar", barId: featured.bar.id });
assert.equal(editor.isDirty(imageSelected), editor.isDirty(imageState));
assert.equal(imageSelected.document, imageState.document);
const imageSaved = editor.editorReducer(imageState, { type: "replaceBar", bar: featured.bar });
assert.equal(editor.isDirty(imageSaved), true);
const lockedImage = soldOut.withSoldOutState(featured.bar, true, true);
const lockedImageState = editor.editorReducer(editor.editorReducer(withBar, { type: "addBar", bar: lockedImage }), { type: "selectPreviewBar", barId: lockedImage.id });
assert.notEqual(lockedImageState.previewBarId, lockedImage.id);
const imageBook = {
  currencyCode: "USD",
  variants: { [variantId]: { available: true, regular: { amountMinor: 1799n, currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: 2500n, currencyCode: "USD", exponent: 2 } } },
};
function imageOffer(bar: { id: string; config: { product: { productId: string; allowedVariantIds: string[]; selectedVariantId: string } } }) {
  return { ...editor.emptyDocument("Image"), products: { items: [{ id: "p1", product: bar.config.product }] }, bars: [bar] };
}
const plainQuote = pricing.quoteDocument(imageOffer(imageBar.bar), { bars: [{ barId: imageBar.bar.id }] }, imageBook);
const imageQuote = pricing.quoteDocument(imageOffer(featured.bar), { bars: [{ barId: featured.bar.id }] }, imageBook);
assert.equal(plainQuote.ok, true);
assert.equal(imageQuote.ok, true);
assert.equal(plainQuote.quote.finalTotal.amountMinor, imageQuote.quote.finalTotal.amountMinor);
const imageTokenState = editor.editorReducer(imageSaved, { type: "imagePageRequested", token: "page-1" });
const staleImages = editor.editorReducer(imageTokenState, { type: "productImagesAppended", token: "old", productId, images: [{ url: "/fixtures/cap.png", alt: "Tee side" }], hasNextPage: false, endCursor: null });
assert.equal(staleImages.previewCatalog, imageTokenState.previewCatalog);
assert.equal(editor.isDirty(staleImages), editor.isDirty(imageTokenState));
const imageDocument = validation.validateDocument({
  ...imageState.document,
  bars: imageState.document.bars.filter((bar: { id: string }) => bar.id === featured.bar.id).map((bar: { images: { customBarImage: unknown; featuredImage: unknown } }) => ({ ...bar, images: { customBarImage: bar.images.customBarImage, featuredImage: bar.images.featuredImage } })),
}, "draft");
assert.equal(imageDocument.ok, true);
assert.equal(imageDocument.document.bars[0].images.barImageSize, 48);
assert.equal(imageDocument.document.bars[0].images.barImageRadius, 6);
const blockedImage = validation.validateDocument({
  ...imageState.document,
  bars: [{ ...featured.bar, images: { ...featured.bar.images, customBarImage: { source: "url", url: "data:image/png;base64,aaaa", alt: null } } }],
}, "draft");
assert.equal(blockedImage.ok, false);

const saved = editor.editorReducer(withBar, {
  type: "saveSucceeded",
  revisionId: "revision-2",
  document: withBar.document,
  status: "DRAFT",
});
assert.equal(editor.isDirty(saved), false);
assert.equal(saved.draftRevisionId, "revision-2");

const router = createMemoryRouter([
  { path: "/app/bundles/:offerId", element: createElement(view.BundleEditor, { offer: {
    offerId: "offer-1",
    status: "DRAFT",
    document: editor.emptyDocument(),
    draftRevisionId: "revision-1",
    publishedRevisionId: null,
    storefrontActive: false,
    codFormActive: false,
    countryCode: "US",
  } }) },
], { initialEntries: ["/app/bundles/offer-1"] });
const html = renderToString(createElement(RouterProvider, { router }));
assert.match(html, /Products/);
assert.match(html, /Save draft/);
assert.match(html, /Quantity break/);
assert.match(html, /Buy X, get Y/);
assert.match(html, /Mix &amp; Match|Mix & Match/);
assert.match(html, /Alternative product/);
assert.match(html, /Publish configuration/);

const imageRouter = createMemoryRouter([
  { path: "/app/bundles/:offerId", element: createElement(view.BundleEditor, { offer: {
    offerId: "offer-1",
    status: "DRAFT",
    document: imageOffer(featured.bar),
    draftRevisionId: "revision-1",
    publishedRevisionId: null,
    storefrontActive: false,
    codFormActive: false,
    countryCode: "US",
  } }) },
], { initialEntries: ["/app/bundles/offer-1"] });
const imageHtml = renderToString(createElement(RouterProvider, { router: imageRouter }));
assert.match(imageHtml, /role="radio"/);
assert.match(imageHtml, /src="\/fixtures\/tee\.png"/);
assert.match(imageHtml, /width="64"/);
assert.match(imageHtml, /border-radius:8px/);
assert.match(imageHtml, /aria-disabled="false"/);

const shopA = crypto.randomUUID();
const shopB = crypto.randomUUID();

try {
  await prisma.shop.create({
    data: {
      id: shopA,
      shopifyShopId: `editor-${shopA}`,
      shopDomain: `${shopA}.example.test`,
      shopName: "Editor A",
      currency: "USD",
      timezone: "UTC",
    },
  });
  await prisma.shop.create({
    data: {
      id: shopB,
      shopifyShopId: `editor-${shopB}`,
      shopDomain: `${shopB}.example.test`,
      shopName: "Editor B",
      currency: "USD",
      timezone: "UTC",
    },
  });

  const created = await persistence.createDraftForShop(`${shopA}.example.test`, prisma);
  assertOk(created);
  const loaded = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  assert.equal(loaded?.status, "DRAFT");
  assert.equal(await persistence.loadOfferForShop(`${shopB}.example.test`, created.offerId, prisma), null);

  const renamedDocument = { ...loaded.draft.document, name: "Saved draft" };
  const draft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    renamedDocument,
    created.revisionId,
    [],
    prisma,
  );
  assertOk(draft);
  const conflict = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    renamedDocument,
    created.revisionId,
    [],
    prisma,
  );
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "conflict");

  const publishable = { ...renamedDocument, bars: [createdBar.bar] };
  const product = {
    id: productId,
    title: "Loaded product",
    status: "ACTIVE",
    featuredImage: null,
    images: [],
    options: [],
    variantsComplete: true,
    variants: [{
      id: variantId,
      title: "Default",
      selectedOptions: [],
      image: null,
      availableForSale: true,
      inventoryQuantity: null,
      catalogPrice: { amount: "14.40", currencyCode: "USD" },
      compareAtPrice: null,
      contextualPrice: { amount: "14.40", currencyCode: "USD" },
      contextualCompareAtPrice: null,
    }],
  };
  const published = await persistence.publishDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    publishable,
    draft.revisionId,
    [product],
    prisma,
  );
  assertOk(published);
  assert.equal(published.storefrontActive, false);
  assert.equal(published.codFormActive, false);
  const afterPublish = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  assert.equal(afterPublish?.status, "PUBLISHED");
  assert.equal(afterPublish?.storefrontActive, false);
  assert.equal(afterPublish?.codFormActive, false);
  await assert.rejects(prisma.$executeRawUnsafe(
    `UPDATE "BundleRevision" SET "schemaVersion" = 1 WHERE "id" = $1::uuid`,
    published.revisionId,
  ));
  const revisionCount = await prisma.bundleRevision.count({ where: { offerId: created.offerId } });
  const emptyPublish = await persistence.publishDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    editor.emptyDocument(),
    afterPublish.draftRevisionId,
    [],
    prisma,
  );
  assert.equal(emptyPublish.ok, false);
  const stalePublish = await persistence.publishDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    publishable,
    created.revisionId,
    [product],
    prisma,
  );
  assert.equal(stalePublish.ok, false);
  assert.equal(await prisma.bundleRevision.count({ where: { offerId: created.offerId } }), revisionCount);
  const detailed = {
    ...publishable,
    bars: [{
      ...createdBar.bar,
      title: "Buy {{quantity}}",
      subtitle: "Save {{saved_amount}}",
      label: "Best",
      config: { ...createdBar.bar.config, quantity: 4, quantitySelector: true },
      pricing: { mode: "percentage_off", basisPoints: 1500, scope: "per_line" },
    }],
  };
  const quantityDraft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    detailed,
    afterPublish.draftRevisionId,
    [product],
    prisma,
  );
  assertOk(quantityDraft);
  const reloaded = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  const savedBar = reloaded?.draft.document.bars[0];
  assert.equal(savedBar?.config.quantity, 4);
  assert.equal(savedBar?.config.quantitySelector, true);
  assert.equal(savedBar?.pricing.mode, "percentage_off");
  assert.equal(savedBar?.pricing.basisPoints, 1500);
  assert.equal(savedBar?.title, "Buy {{quantity}}");
  assert.equal(savedBar?.subtitle, "Save {{saved_amount}}");
  assert.equal(savedBar?.label, "Best");
  const bxgyDocument = {
    ...detailed,
    bars: [{
      ...bxgyCreated.bar,
      title: "Buy {{buy_quantity}}",
      subtitle: "Get {{get_quantity}}",
      pricing: { mode: "percentage_off", basisPoints: 1000, scope: "per_line" },
      config: {
        ...bxgyCreated.bar.config,
        buyQuantity: 2,
        getQuantity: 1,
        getPricing: { mode: "percentage_off", basisPoints: 10000, scope: "per_line" },
        getProduct: null,
      },
    }],
  };
  const bxgyDraft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    bxgyDocument,
    quantityDraft.revisionId,
    [product],
    prisma,
  );
  assertOk(bxgyDraft);
  const reloadedBxgy = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  const savedBxgy = reloadedBxgy?.draft.document.bars[0];
  assert.equal(savedBxgy?.type, "buy_x_get_y");
  assert.equal(savedBxgy?.config.buyQuantity, 2);
  assert.equal(savedBxgy?.config.getQuantity, 1);
  assert.equal(savedBxgy?.config.getProduct, null);
  assert.equal(savedBxgy?.pricing.basisPoints, 1000);
  assert.equal(savedBxgy?.config.getPricing.basisPoints, 10000);
  assert.equal(savedBxgy?.title, "Buy {{buy_quantity}}");
  assert.equal(savedBxgy?.subtitle, "Get {{get_quantity}}");
  const bundleDocument = {
    ...detailed,
    bars: [bundleOffer(
      [
        bundleRow("row-a", productId, [variantId, variantA2], variantId, 2, { mode: "percentage_off", basisPoints: 1000, scope: "per_line" }, "default", true),
        bundleRow("row-b", productB, [variantB], variantB, 1, { mode: "amount_off", amount: { amountMinor: "100", currencyCode: "USD" }, scope: "per_item" }),
        rowC,
      ],
      "horizontal",
      true,
      true,
    )],
  };
  const catalogProduct = (id: string, variants: Array<{ id: string }>) => ({
    id,
    title: id,
    status: "ACTIVE",
    featuredImage: null,
    images: [] as Array<{ url: string; alt: string | null }>,
    imagesComplete: true,
    options: [],
    variantsComplete: true,
    variants: variants.map((variant) => ({
      ...variant,
      title: "Variant",
      selectedOptions: [],
      image: null,
      availableForSale: true,
      inventoryQuantity: null,
      catalogPrice: { amount: "1.00", currencyCode: "USD" },
      compareAtPrice: null,
      contextualPrice: { amount: "1.00", currencyCode: "USD" },
      contextualCompareAtPrice: null,
    })),
  });
  const bundleDraft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    bundleDocument,
    bxgyDraft.revisionId,
    [
      catalogProduct(productId, [{ id: variantId }, { id: variantA2 }]),
      catalogProduct(productB, [{ id: variantB }]),
      catalogProduct(productC, [{ id: variantC }]),
    ],
    prisma,
  );
  assertOk(bundleDraft);
  const reloadedBundle = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  const savedBundle = reloadedBundle?.draft.document.bars[0];
  assert.equal(savedBundle?.type, "product_bundle");
  assert.equal(savedBundle?.config.layout, "horizontal");
  assert.equal(savedBundle?.config.hideIndividualPrice, true);
  assert.equal(savedBundle?.config.showOnlyWhenSelected, true);
  assert.equal(savedBundle?.config.products.length, 3);
  assert.equal(savedBundle?.config.products[0].role, "default");
  assert.equal(savedBundle?.config.products[0].quantity, 2);
  assert.equal(savedBundle?.config.products[0].quantitySelector, true);
  assert.equal(savedBundle?.config.products[0].pricing.basisPoints, 1000);
  assert.equal(savedBundle?.config.products[0].product.allowedVariantIds.join(","), `${variantId},${variantA2}`);
  assert.equal(savedBundle?.config.products[1].pricing.mode, "amount_off");
  assert.equal(savedBundle?.config.products[1].pricing.amount.amountMinor, "100");
  assert.equal(savedBundle?.config.products[2].id, "row-c");
  assert.equal(savedBundle?.config.products[2].product.productId, productC);
  const mixDocumentSaved = {
    ...detailed,
    bars: [{
      ...mixCreated.bar,
      title: "Bundle & Save",
      subtitle: "Save {{saved_amount}}",
      label: "Mix",
      pricing: { mode: "percentage_off", basisPoints: 1500, scope: "per_deal" },
      config: {
        showPrices: false,
        showOnlyWhenSelected: true,
        changeButtonLabel: "Swap",
        selectionModal: { title: "Select product" },
        slots: [
          mixSlot("slot-a", productId, mixA, "default", [], [mixCollection]),
          mixSlot("slot-b", productB, mixB, "additional"),
        ],
      },
    }],
  };
  const mixDraft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    mixDocumentSaved,
    bundleDraft.revisionId,
    [
      catalogProduct(productId, [{ id: mixA }, { id: mixA2 }]),
      catalogProduct(productB, [{ id: mixB }]),
    ],
    prisma,
  );
  assertOk(mixDraft);
  const reloadedMix = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  const savedMix = reloadedMix?.draft.document.bars[0];
  assert.equal(savedMix?.type, "mix_and_match");
  assert.equal(savedMix?.title, "Bundle & Save");
  assert.equal(savedMix?.subtitle, "Save {{saved_amount}}");
  assert.equal(savedMix?.label, "Mix");
  assert.equal(savedMix?.pricing.basisPoints, 1500);
  assert.equal(savedMix?.pricing.scope, "per_deal");
  assert.equal(savedMix?.config.showPrices, false);
  assert.equal(savedMix?.config.showOnlyWhenSelected, true);
  assert.equal(savedMix?.config.changeButtonLabel, "Swap");
  assert.equal(savedMix?.config.selectionModal.title, "Select product");
  assert.equal(savedMix?.config.slots[0].title, "{{product}}");
  assert.equal(savedMix?.config.slots[0].swapCollectionIds[0], mixCollection);
  assert.equal(savedMix?.config.slots[0].product.allowedVariantIds.join(","), `${mixA},${mixA2}`);
  assert.equal(savedMix?.config.slots[1].product.productId, productB);
  assert.equal(savedMix?.config.slots[1].id, "slot-b");
  const alternativeDocument = {
    ...detailed,
    bars: [{
      ...alternative.bar,
      title: "{{product}}",
      subtitle: "Save {{saved_amount}}",
      label: "Spare",
      selectedByDefault: true,
      pricing: { mode: "amount_off" as const, amount: { amountMinor: "150", currencyCode: "USD" }, scope: "per_item" as const },
      config: {
        product: { productId: spareId, allowedVariantIds: [buy1, buy2], selectedVariantId: buy2 },
        quantity: 3,
      },
      images: {
        customBarImage: { source: "catalog", productId: spareId, url: "/fixtures/spare.png", alt: "Spare" },
        featuredImage: { source: "catalog", productId: spareId, url: "/fixtures/spare.png", alt: "Spare feature" },
        barImageSize: 48,
        barImageRadius: 6,
      },
    }],
  };
  const spareCatalog = catalogProduct(spareId, [{ id: buy1 }, { id: buy2 }]);
  spareCatalog.images = [{ url: "/fixtures/spare.png", alt: "Spare" }];
  spareCatalog.imagesComplete = true;
  const alternativeDraft = await persistence.saveDraftForShop(
    `${shopA}.example.test`,
    created.offerId,
    alternativeDocument,
    mixDraft.revisionId,
    [spareCatalog],
    prisma,
    { allowFixtureImages: true },
  );
  assertOk(alternativeDraft);
  const reloadedAlternative = await persistence.loadOfferForShop(`${shopA}.example.test`, created.offerId, prisma);
  const savedAlternative = reloadedAlternative?.draft.document.bars[0];
  assert.equal(savedAlternative?.type, "alternative_product");
  assert.equal(savedAlternative?.title, "{{product}}");
  assert.equal(savedAlternative?.subtitle, "Save {{saved_amount}}");
  assert.equal(savedAlternative?.label, "Spare");
  assert.equal(savedAlternative?.selectedByDefault, true);
  assert.equal(savedAlternative?.pricing.mode, "amount_off");
  assert.equal(savedAlternative?.pricing.scope, "per_item");
  assert.equal(savedAlternative?.pricing.amount.amountMinor, "150");
  assert.equal(savedAlternative?.config.quantity, 3);
  assert.equal(savedAlternative?.config.product.productId, spareId);
  assert.equal(savedAlternative?.config.product.selectedVariantId, buy2);
  assert.equal(savedAlternative?.config.product.allowedVariantIds.join(","), `${buy1},${buy2}`);
  assert.equal(savedAlternative?.images.barImageSize, 48);
  assert.equal(savedAlternative?.images.barImageRadius, 6);
  assert.equal(savedAlternative?.images.customBarImage?.source, "catalog");
  assert.equal(savedAlternative?.images.customBarImage?.url, "/fixtures/spare.png");
  assert.equal(savedAlternative?.images.featuredImage?.url, "/fixtures/spare.png");
  assert.equal(await persistence.loadOfferForShop(`${shopB}.example.test`, created.offerId, prisma), null);
} finally {
  await prisma.shop.deleteMany({ where: { id: { in: [shopA, shopB] } } });
  await prisma.$disconnect();
  await vite.close();
}

console.log(JSON.stringify({ ok: true, editor: "tested" }));
