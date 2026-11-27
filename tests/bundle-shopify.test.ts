import assert from "node:assert/strict";
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

const catalog = await vite.ssrLoadModule("/app/bundles/shopify/catalog.ts");
const selection = await vite.ssrLoadModule("/app/bundles/shopify/selection.ts");
const products = await vite.ssrLoadModule("/app/bundles/shopify/products.server.ts");
const collections = await vite.ssrLoadModule("/app/bundles/shopify/collections.server.ts");
const picker = await vite.ssrLoadModule("/app/components/shopify-resource-picker.tsx");
const validate = await vite.ssrLoadModule("/app/bundles/validate.ts");
const pricing = await vite.ssrLoadModule("/app/bundles/pricing.ts");

const productId = "gid://shopify/Product/1";
const variantA = "gid://shopify/ProductVariant/1";
const variantB = "gid://shopify/ProductVariant/2";
const collectionId = "gid://shopify/Collection/9";

function rawProduct(overrides = {}) {
  return {
    __typename: "Product",
    id: productId,
    title: "Tee",
    status: "ACTIVE",
    featuredImage: { url: "https://cdn.example.com/tee.jpg", altText: "Tee" },
    options: [{ id: "gid://shopify/ProductOption/1", name: "Size", values: ["S", "M"] }],
    images: { nodes: [{ url: "https://cdn.example.com/tee.jpg", altText: "Tee" }] },
    variants: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [
        {
          id: variantA,
          title: "S",
          availableForSale: true,
          price: "17.99",
          compareAtPrice: "20.00",
          selectedOptions: [{ name: "Size", value: "S" }],
          image: { url: "https://cdn.example.com/s.jpg", altText: "S" },
          contextualPricing: { price: { amount: "5000.00", currencyCode: "PKR" }, compareAtPrice: { amount: "6000.00", currencyCode: "PKR" } },
        },
        {
          id: variantB,
          title: "M",
          availableForSale: false,
          price: "18.99",
          compareAtPrice: null,
          selectedOptions: [{ name: "Size", value: "M" }],
          image: null,
          contextualPricing: { price: { amount: "5100.00", currencyCode: "PKR" }, compareAtPrice: null },
        },
      ],
    },
    ...overrides,
  };
}

function admin(handler: (query: string, variables: Record<string, unknown>) => unknown) {
  return {
    graphql: async (query: string, options?: { variables?: Record<string, unknown> }) => ({
      json: async () => handler(query, options?.variables ?? {}),
    }),
  };
}

const normalized = catalog.normalizeProduct(rawProduct(), "USD");
assert.equal(normalized.title, "Tee");
assert.equal(normalized.featuredImage.url, "https://cdn.example.com/tee.jpg");
assert.equal(normalized.variants[0].selectedOptions[0].value, "S");
assert.equal(normalized.variants[0].catalogPrice.amount, "17.99");
assert.equal(normalized.variants[0].contextualPrice.currencyCode, "PKR");
assert.equal(normalized.variants[1].availableForSale, false);
assert.equal(normalized.images.length, 1);
assert.equal(normalized.imagesComplete, true);
const pagedImages = catalog.normalizeProduct(rawProduct({
  images: {
    pageInfo: { hasNextPage: true, endCursor: "image-2" },
    nodes: [{ url: "https://cdn.example.com/tee.jpg", altText: "Tee" }, { url: null, altText: "Missing" }],
  },
}), "USD");
assert.equal(pagedImages.imagesComplete, false);
assert.equal(pagedImages.imagesCursor, "image-2");
assert.equal(pagedImages.images.some((image: { url: string }) => image.url == null), false);
const imagePage = await products.loadProductImages(admin(() => ({
  data: { product: { id: productId, images: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ url: "https://cdn.example.com/side.jpg", altText: "Side" }, { url: null }] } } },
})), { sessionShop: "aura-data.myshopify.com", productId, cursor: "image-2", requestToken: "images" });
assert.equal(imagePage.ok, true);
assert.equal(imagePage.images.length, 1);
assert.equal(imagePage.images[0].url, "https://cdn.example.com/side.jpg");
const missingImage = await products.loadProductImages(admin(() => ({ data: { product: null } })), {
  sessionShop: "aura-data.myshopify.com",
  productId,
  requestToken: "gone",
});
assert.equal(missingImage.unavailable, true);
assert.equal((await products.loadProductImages(admin(() => ({})), {
  sessionShop: "aura-data.myshopify.com",
  claimedShop: "other.myshopify.com",
  productId,
  requestToken: "cross",
})).code, "cross_merchant");

const current = [{ id: productId, title: "Tee", variants: [{ id: variantA, title: "S" }] }];
const cancelled = selection.applyPickerResult(current, undefined, "single");
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.selection.length, 1);
const multiple = selection.applyPickerResult(current, [current[0], { id: "gid://shopify/Product/2", title: "Other", variants: [] }], "single");
assert.equal(multiple.ok, false);
assert.equal(multiple.code, "too_many");
const replaced = selection.applyPickerResult(current, [{ id: "gid://shopify/Product/2", title: "Other", variants: [] }], "multiple");
assert.equal(replaced.selection[0].id, "gid://shopify/Product/2");
assert.equal(selection.removePickerResource(current, productId).length, 0);

const unavailable = selection.buildVariantSelection(productId, [{ id: variantB, available: false }], null);
assert.equal(unavailable.ok, false);
assert.equal(unavailable.code, "no_available_variant");
const explicitUnavailable = selection.buildVariantSelection(productId, [
  { id: variantA, available: true },
  { id: variantB, available: false },
], variantB);
assert.equal(explicitUnavailable.code, "unavailable_preselection");
const chosen = selection.buildVariantSelection(productId, [
  { id: variantA, available: true },
  { id: variantB, available: false },
], null);
assert.equal(chosen.selection.selectedVariantId, variantA);
assert.deepEqual(chosen.selection.allowedVariantIds, [variantA, variantB]);
const override = selection.customerVariantChoice([variantA, variantB], [variantA], variantA, variantA);
assert.equal(override.variantId, variantA);
assert.equal(selection.customerVariantChoice([variantA, variantB], [variantA], variantA, variantB).code, "unavailable_variant");

let calls = 0;
const cross = await products.loadProductsForMerchant(admin(() => {
  calls += 1;
  return {};
}), {
  sessionShop: "aura-data.myshopify.com",
  claimedShop: "other.myshopify.com",
  productIds: [productId],
  requestToken: "one",
  scopes: ["write_products"],
});
assert.equal(cross.code, "cross_merchant");
assert.equal(calls, 0);

const invalid = await products.loadProductsForMerchant(admin(() => ({})), {
  sessionShop: "aura-data.myshopify.com",
  productIds: ["product-1"],
  requestToken: "one",
  scopes: ["write_products"],
});
assert.equal(invalid.code, "invalid_id");

const loaded = await products.loadProductsForMerchant(admin(() => ({
  data: { shop: { currencyCode: "USD" }, nodes: [rawProduct()] },
})), {
  sessionShop: "aura-data.myshopify.com",
  productIds: [productId],
  countryCode: "PK",
  requestToken: "fresh",
  scopes: ["write_products"],
});
assert.equal(loaded.ok, true);
assert.equal(loaded.catalog.inventory, "missing_scope");
assert.equal(loaded.catalog.products[0].variants[0].inventoryQuantity, null);
assert.equal(catalog.acceptFreshResponse("newer", loaded.catalog).code, "stale_response");
const book = catalog.priceBookFromProducts(loaded.catalog.products, "PK", "USD");
assert.equal(book.ok, true);
assert.equal(book.book.currencyCode, "PKR");
assert.equal(book.book.variants[variantA].regular.amountMinor, 500000n);
assert.equal(book.book.variants[variantA].compareAt.amountMinor, 600000n);
assert.equal(normalized.variants[0].compareAtPrice.amount, "20.00");
assert.equal(book.book.variants[variantB].available, false);
const referenceProduct = catalog.normalizeProduct(rawProduct({
  variants: {
    pageInfo: { hasNextPage: false, endCursor: null },
    nodes: [
      { id: variantA, title: "Low", availableForSale: true, price: "17.99", compareAtPrice: "10.00", selectedOptions: [], image: null },
      { id: variantB, title: "Equal", availableForSale: true, price: "17.99", compareAtPrice: "17.99", selectedOptions: [], image: null },
      { id: "gid://shopify/ProductVariant/3", title: "High", availableForSale: true, price: "17.99", compareAtPrice: "30.00", selectedOptions: [], image: null },
      { id: "gid://shopify/ProductVariant/4", title: "Missing", availableForSale: true, price: "17.99", compareAtPrice: null, selectedOptions: [], image: null },
    ],
  },
}), "USD");
assert.equal(referenceProduct.variants[0].compareAtPrice.amount, "10.00");
assert.equal(referenceProduct.variants[1].compareAtPrice.amount, "17.99");
assert.equal(referenceProduct.variants[2].compareAtPrice.amount, "30.00");
assert.equal(referenceProduct.variants[3].compareAtPrice, null);
const referenceBook = catalog.priceBookFromProducts([referenceProduct], null, "USD");
assert.equal(referenceBook.ok, true);
assert.equal(referenceBook.book.variants[variantA].compareAt, null);
assert.equal(referenceBook.book.variants[variantB].compareAt, null);
assert.equal(referenceBook.book.variants["gid://shopify/ProductVariant/3"].compareAt.amountMinor, 3000n);
assert.equal(referenceBook.book.variants["gid://shopify/ProductVariant/4"].compareAt, null);

const missingContextual = catalog.priceBookFromProducts([
  catalog.normalizeProduct(rawProduct({
    variants: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ id: variantA, title: "S", availableForSale: true, price: "10.00", compareAtPrice: null, selectedOptions: [], image: null }],
    },
  }), "USD"),
], "PK", "USD");
assert.equal(missingContextual.code, "contextual_unavailable");

const zeroGap = catalog.priceBookFromProducts([
  catalog.normalizeProduct(rawProduct({
    variants: {
      pageInfo: { hasNextPage: false, endCursor: null },
      nodes: [{ id: variantA, title: "S", availableForSale: true, price: null, compareAtPrice: null, selectedOptions: [], image: null }],
    },
  }), "USD"),
], null, "USD");
assert.equal(zeroGap.code, "missing_price");

const mixed = catalog.priceBookFromProducts([
  {
    ...loaded.catalog.products[0],
    variants: [
      loaded.catalog.products[0].variants[0],
      { ...loaded.catalog.products[0].variants[0], id: variantB, contextualPrice: { amount: "10.00", currencyCode: "USD" } },
    ],
  },
], "PK", "USD");
assert.equal(mixed.code, "mixed_currency");

let queries = 0;
const paged = await products.loadProductsForMerchant(admin((query: string) => {
  queries += 1;
  if (query.includes("BundleVariantPage")) {
    return {
      data: {
        product: {
          variants: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [{ id: variantB, title: "M", availableForSale: true, price: "19.00", compareAtPrice: null, selectedOptions: [], image: null }],
          },
        },
      },
    };
  }
  return {
    data: {
      shop: { currencyCode: "USD" },
      nodes: [rawProduct({ variants: { pageInfo: { hasNextPage: true, endCursor: "cursor-1" }, nodes: [rawProduct().variants.nodes[0]] } })],
    },
  };
}), {
  sessionShop: "aura-data.myshopify.com",
  productIds: [productId],
  requestToken: "page",
  scopes: ["write_products"],
});
assert.equal(paged.ok, true);
assert.equal(queries, 2);
assert.equal(paged.catalog.complete, true);
assert.equal(paged.catalog.truncatedProductIds.length, 0);
assert.equal(paged.catalog.products[0].variants.length, 2);

let truncatedQueries = 0;
const truncated = await products.loadProductsForMerchant(admin((query: string) => {
  truncatedQueries += 1;
  if (query.includes("BundleVariantPage")) {
    return {
      data: {
        product: {
          variants: {
            pageInfo: { hasNextPage: true, endCursor: `cursor-${truncatedQueries}` },
            nodes: [{ id: variantB, title: "M", availableForSale: true, price: "19.00", compareAtPrice: null, selectedOptions: [], image: null }],
          },
        },
      },
    };
  }
  return {
    data: {
      shop: { currencyCode: "USD" },
      nodes: [rawProduct({ variants: { pageInfo: { hasNextPage: true, endCursor: "cursor-1" }, nodes: [rawProduct().variants.nodes[0]] } })],
    },
  };
}), {
  sessionShop: "aura-data.myshopify.com",
  productIds: [productId],
  requestToken: "truncated",
  scopes: ["write_products"],
  sleep: async () => {},
});
assert.equal(truncated.ok, true);
assert.equal(truncated.catalog.complete, false);
assert.deepEqual(truncated.catalog.truncatedProductIds, [productId]);
assert.equal(truncatedQueries, 11);

const failed = await products.loadProductsForMerchant(admin(() => ({ errors: [{ message: "No access" }] })), {
  sessionShop: "aura-data.myshopify.com",
  productIds: [productId],
  requestToken: "err",
  scopes: ["write_products"],
});
assert.equal(failed.code, "graphql_error");

let attempts = 0;
const throttled = await products.loadProductsForMerchant(admin(() => {
  attempts += 1;
  if (attempts === 1) return { errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }], extensions: { cost: { throttleStatus: { currentlyAvailable: 0, restoreRate: 100 } } } };
  return { data: { shop: { currencyCode: "USD" }, nodes: [rawProduct()] } };
}), {
  sessionShop: "aura-data.myshopify.com",
  productIds: [productId],
  requestToken: "retry",
  scopes: ["write_products"],
  sleep: async () => {},
});
assert.equal(throttled.ok, true);
assert.equal(attempts, 2);

const page = await collections.listCollectionProducts(admin(() => ({
  data: {
    collection: {
      id: collectionId,
      title: "Summer",
      products: {
        pageInfo: { hasNextPage: true, endCursor: "next" },
        nodes: [{ id: productId, title: "Tee", status: "ACTIVE", variants: { pageInfo: { hasNextPage: false }, nodes: [{ id: variantA, title: "S", availableForSale: true }] } }],
      },
    },
  },
})), {
  sessionShop: "aura-data.myshopify.com",
  collectionId,
  requestToken: "collection",
});
assert.equal(page.page.hasNextPage, true);
assert.equal(page.page.endCursor, "next");
assert.equal(page.page.products[0].variantsComplete, true);

const denied = await collections.verifyCollectionMembership(admin(() => ({
  data: { collection: { id: collectionId, hasProduct: false } },
})), {
  sessionShop: "aura-data.myshopify.com",
  claimedShop: "aura-data.myshopify.com",
  collectionId,
  productId,
  variantIds: [variantA],
  requestToken: "member",
});
assert.equal(denied.code, "not_member");

const verified = await collections.verifyCollectionMembership(admin((query: string) => {
  if (query.includes("hasProduct")) return { data: { collection: { id: collectionId, hasProduct: true } } };
  return { data: { shop: { currencyCode: "USD" }, nodes: [rawProduct()] } };
}), {
  sessionShop: "aura-data.myshopify.com",
  collectionId,
  productId,
  variantIds: [variantA],
  requestToken: "member",
});
assert.equal(verified.ok, true);
assert.deepEqual(verified.membership.variantIds, [variantA]);

const incompleteMember = await collections.verifyCollectionMembership(admin((query: string) => {
  if (query.includes("hasProduct")) return { data: { collection: { id: collectionId, hasProduct: true } } };
  if (query.includes("BundleVariantPage")) {
    return { data: { product: { variants: { pageInfo: { hasNextPage: true, endCursor: "more" }, nodes: [] } } } };
  }
  return {
    data: {
      shop: { currencyCode: "USD" },
      nodes: [rawProduct({ variants: { pageInfo: { hasNextPage: true, endCursor: "more" }, nodes: [rawProduct().variants.nodes[0]] } })],
    },
  };
}), {
  sessionShop: "aura-data.myshopify.com",
  collectionId,
  productId,
  variantIds: ["gid://shopify/ProductVariant/99"],
  requestToken: "incomplete-member",
  sleep: async () => {},
});
assert.equal(incompleteMember.ok, false);
assert.equal(incompleteMember.code, "incomplete_catalog");

function variant(id: number, allowed: number[] = [id]) {
  return {
    productId,
    allowedVariantIds: allowed.map((value) => `gid://shopify/ProductVariant/${value}`),
    selectedVariantId: `gid://shopify/ProductVariant/${id}`,
  };
}

const document = validate.validateDocument({
  schemaVersion: 1,
  name: "Offer",
  products: { items: [] },
  settings: { extensions: null },
  style: { extensions: null },
  bars: [{
    id: "qty",
    type: "quantity_break",
    title: "Qty",
    subtitle: "",
    label: "",
    textTemplate: "",
    selectedByDefault: false,
    pricing: { mode: "full_price" },
    images: { customBarImage: null, featuredImage: null },
    upsells: [],
    gifts: { selection: "single", items: [] },
    freeShipping: { enabled: false, maximumRate: null },
    personalisation: { enabled: false, perUnit: false, fields: [] },
    highlights: [],
    soldOut: { appearance: "hide", restrictSelection: true },
    extensions: null,
    config: { product: variant(1, [1, 2, 3]), quantity: 1, quantitySelector: false },
  }, {
    id: "mix",
    type: "mix_and_match",
    title: "Mix",
    subtitle: "",
    label: "",
    textTemplate: "",
    selectedByDefault: false,
    pricing: { mode: "full_price" },
    images: { customBarImage: null, featuredImage: null },
    upsells: [],
    gifts: { selection: "single", items: [] },
    freeShipping: { enabled: false, maximumRate: null },
    personalisation: { enabled: false, perUnit: false, fields: [] },
    highlights: [],
    soldOut: { appearance: "hide", restrictSelection: true },
    extensions: null,
    config: {
      showPrices: true,
      showOnlyWhenSelected: false,
      changeButtonLabel: "Change",
      selectionModal: { title: "Choose" },
      slots: [{
        id: "slot",
        role: "default",
        title: "{{product}}",
        product: variant(1, [1]),
        swapProducts: [],
        swapCollectionIds: [collectionId],
      }],
    },
  }],
  modal: { extensions: null },
  targeting: { productIds: [], collectionIds: [] },
  extensions: null,
}, "publish");
assert.equal(document.ok, true);

function moneyBook(prices: Record<string, number>) {
  const variants: Record<string, { regular: { amountMinor: bigint; currencyCode: string; exponent: number }; compareAt: null; available: boolean }> = {};
  for (const [id, amount] of Object.entries(prices)) {
    variants[`gid://shopify/ProductVariant/${id}`] = {
      regular: { amountMinor: BigInt(amount), currencyCode: "USD", exponent: 2 },
      compareAt: null,
      available: id !== "2",
    };
  }
  return { currencyCode: "USD", variants };
}

const overridden = pricing.quoteDocument(document.document, { bars: [{ barId: "qty", variantId: "gid://shopify/ProductVariant/3" }] }, moneyBook({ 1: 1799, 2: 1899, 3: 2500 }));
assert.equal(overridden.ok, true);
assert.equal(overridden.quote.finalTotal.amountMinor, 2500n);
const soldOut = pricing.quoteDocument(document.document, { bars: [{ barId: "qty", variantId: variantB }] }, moneyBook({ 1: 1799, 2: 1899, 3: 2500 }));
assert.equal(soldOut.ok, false);
assert.equal(soldOut.errors.some((error: { code: string }) => error.code === "sold_out"), true);
const outside = pricing.quoteDocument(document.document, { bars: [{ barId: "qty", variantId: "gid://shopify/ProductVariant/9" }] }, moneyBook({ 1: 1799, 2: 1899, 3: 2500 }));
assert.equal(outside.errors.some((error: { code: string }) => error.code === "variant_not_allowed"), true);

const unproven = pricing.quoteDocument(document.document, {
  bars: [{ barId: "mix", slots: [{ slotId: "slot", variantId: "gid://shopify/ProductVariant/8" }] }],
}, moneyBook({ 1: 1799, 8: 1000 }));
assert.equal(unproven.ok, false);
const proven = pricing.quoteDocument(document.document, {
  bars: [{ barId: "mix", slots: [{ slotId: "slot", variantId: "gid://shopify/ProductVariant/8" }] }],
}, moneyBook({ 1: 1799, 8: 1000 }), {
  memberships: [{ collectionId, productId, variantIds: ["gid://shopify/ProductVariant/8"] }],
});
assert.equal(proven.ok, true);
assert.equal(proven.quote.finalTotal.amountMinor, 1000n);

const markup = renderToStaticMarkup(createElement(picker.ShopifyResourceField, {
  label: "Choose product",
  purpose: "quantity_break",
  resource: "product",
  selection: current,
  onChange: () => {},
  picker: async () => undefined,
}));
assert.match(markup, /Tee/);
assert.match(markup, /Remove/);

await vite.close();
console.log(JSON.stringify({ ok: true, shopify: "mocked" }));
