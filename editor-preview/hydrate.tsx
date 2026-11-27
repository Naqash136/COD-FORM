import { createRoot } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router";
import { BundleEditor } from "../app/components/bundle-editor";
import { createBar, emptyDocument } from "../app/bundles/editor-state";
import { withSoldOutState } from "../app/bundles/sold-out";

const productId = "gid://shopify/Product/1";
const productBId = "gid://shopify/Product/2";
const small = "gid://shopify/ProductVariant/1";
const large = "gid://shopify/ProductVariant/2";
const variantB = "gid://shopify/ProductVariant/21";
const product = {
  id: productId,
  title: "Tee",
  status: "ACTIVE" as const,
  featuredImageUrl: "/fixtures/tee.png",
  featuredImageAlt: "Tee",
  images: [{ url: "/fixtures/tee.png", alt: "Tee" }],
  imagesComplete: false,
  imagesCursor: "tee-2",
  variantsComplete: true,
  variants: [
    { id: small, title: "Small", availableForSale: true, regularLabel: "17.99 USD", compareLabel: "25.00 USD" },
    { id: large, title: "Large", availableForSale: true, regularLabel: "19.99 USD", compareLabel: null },
  ],
};
const productCId = "gid://shopify/Product/3";
const variantC = "gid://shopify/ProductVariant/31";
const spareId = "gid://shopify/Product/4";
const buy1 = "gid://shopify/ProductVariant/41";
const buy2 = "gid://shopify/ProductVariant/42";
const summerCollection = "gid://shopify/Collection/9";
const productB = {
  id: productBId,
  title: "Product B",
  status: "ACTIVE" as const,
  featuredImageUrl: "/fixtures/product-b.png",
  featuredImageAlt: "Product B",
  images: [{ url: "/fixtures/product-b.png", alt: "Product B" }],
  imagesComplete: true,
  imagesCursor: null,
  variantsComplete: true,
  variants: [
    { id: variantB, title: "Default", availableForSale: true, regularLabel: "46.99 USD", compareLabel: "59.00 USD" },
  ],
};
const spare = {
  id: spareId,
  title: "Spare",
  status: "ACTIVE" as const,
  featuredImageUrl: "/fixtures/spare.png",
  featuredImageAlt: "Spare",
  images: [{ url: "/fixtures/spare.png", alt: "Spare" }],
  imagesComplete: true,
  imagesCursor: null,
  variantsComplete: true,
  variants: [
    { id: buy1, title: "Buy 1", availableForSale: true, regularLabel: "24.50 USD", compareLabel: "39.00 USD" },
    { id: buy2, title: "Buy 2", availableForSale: true, regularLabel: "46.99 USD", compareLabel: "59.00 USD" },
  ],
};
const productC = {
  id: productCId,
  title: "Cap",
  status: "ACTIVE" as const,
  featuredImageUrl: "/fixtures/cap.png",
  featuredImageAlt: "Cap",
  images: [{ url: "/fixtures/cap.png", alt: "Cap" }],
  imagesComplete: true,
  imagesCursor: null,
  variantsComplete: true,
  variants: [
    { id: variantC, title: "Default", availableForSale: true, regularLabel: "16.99 USD", compareLabel: "25.00 USD" },
  ],
};
const first = createBar("quantity_break", product, "bar-a");
const second = createBar("quantity_break", product, "bar-b");
const third = createBar("quantity_break", product, "bar-c");
const fourth = createBar("buy_x_get_y", product, "bar-bxgy");
const bundle = createBar("product_bundle", product, "bar-bundle");
const pair = createBar("product_bundle", product, "bar-pair");
const mix = createBar("mix_and_match", product, "bar-mix");
if (!first.ok || first.bar.type !== "quantity_break" || !second.ok || second.bar.type !== "quantity_break" || !third.ok || third.bar.type !== "quantity_break" || !fourth.ok || fourth.bar.type !== "buy_x_get_y" || !bundle.ok || bundle.bar.type !== "product_bundle" || !pair.ok || pair.bar.type !== "product_bundle" || !mix.ok || mix.bar.type !== "mix_and_match") {
  throw new Error("Editor fixture could not be created.");
}

const offerDocument = {
  ...emptyDocument("Quantity break"),
  products: {
    items: [{
      id: "p1",
      product: { productId, allowedVariantIds: [small, large], selectedVariantId: small },
    }],
  },
  bars: [
    {
      ...first.bar,
      selectedByDefault: true,
      title: "Buy {{quantity}}",
      subtitle: "Save {{saved_amount}}",
      label: "One",
      config: { ...first.bar.config, quantity: 1, quantitySelector: true },
    },
    {
      ...second.bar,
      title: "Pack",
      config: { ...second.bar.config, quantity: 4, quantitySelector: true },
      pricing: { mode: "fixed_price" as const, amount: { amountMinor: "300", currencyCode: "USD" }, scope: "per_group" as const },
    },
    withSoldOutState({ ...third.bar, title: "Gone" }, true, true),
    {
      ...fourth.bar,
      title: "Buy {{buy_quantity}} get {{get_quantity}}",
      subtitle: "{{quantity}} items",
      label: "Deal",
      textTemplate: "Save {{saved_amount}}",
      config: {
        ...fourth.bar.config,
        buyQuantity: 1,
        getQuantity: 1,
        getPricing: { mode: "percentage_off" as const, basisPoints: 10000, scope: "per_line" as const },
        getProduct: null,
      },
    },
    {
      ...bundle.bar,
      title: "Bundle {{quantity}}",
      subtitle: "Save {{saved_amount}}",
      label: "Set",
      config: {
        ...bundle.bar.config,
        products: bundle.bar.config.products.map((row) => ({ ...row, quantitySelector: true })),
      },
    },
    {
      ...pair.bar,
      title: "Pair",
      config: {
        ...pair.bar.config,
        products: pair.bar.config.products.map((row) => ({
          ...row,
          pricing: { mode: "fixed_price" as const, amount: { amountMinor: "1000", currencyCode: "USD" }, scope: "per_group" as const },
        })),
      },
    },
    {
      ...mix.bar,
      config: {
        ...mix.bar.config,
        slots: mix.bar.config.slots.map((slot) => ({
          ...slot,
          swapProducts: [{ productId: productBId, allowedVariantIds: [variantB], selectedVariantId: variantB }],
          swapCollectionIds: [summerCollection],
        })),
      },
    },
  ],
};

const fixtureProducts = [product, productB, productC, spare];
const fixturePrices: Record<string, { available: boolean; regular: { amountMinor: string; currencyCode: string; exponent: number }; compareAt: { amountMinor: string; currencyCode: string; exponent: number } | null }> = {
  [small]: { available: true, regular: { amountMinor: "1799", currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: "2500", currencyCode: "USD", exponent: 2 } },
  [large]: { available: true, regular: { amountMinor: "1999", currencyCode: "USD", exponent: 2 }, compareAt: null },
  [variantB]: { available: true, regular: { amountMinor: "4699", currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: "5900", currencyCode: "USD", exponent: 2 } },
  [variantC]: { available: true, regular: { amountMinor: "1699", currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: "2500", currencyCode: "USD", exponent: 2 } },
  [buy1]: { available: true, regular: { amountMinor: "2450", currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: "3900", currencyCode: "USD", exponent: 2 } },
  [buy2]: { available: true, regular: { amountMinor: "4699", currencyCode: "USD", exponent: 2 }, compareAt: { amountMinor: "5900", currencyCode: "USD", exponent: 2 } },
};

(globalThis as { shopify?: { resourcePicker: (options: unknown) => Promise<Array<{ id: string; title: string; variants: Array<{ id: string; title: string }> }>> } }).shopify = {
  resourcePicker: async (options) => {
    const request = options as { type?: string; action?: string; selectionIds?: Array<{ id: string }> };
    if (request.type === "collection") return [{ id: summerCollection, title: "Summer", variants: [] }];
    if (request.action === "select") {
      if (request.selectionIds?.[0]?.id === spareId) return [{ id: productBId, title: "Product B", variants: [{ id: variantB, title: "Default" }] }];
      return [{ id: spareId, title: "Spare", variants: [{ id: buy1, title: "Buy 1" }, { id: buy2, title: "Buy 2" }] }];
    }
    return [{ id: productBId, title: "Product B", variants: [{ id: variantB, title: "Default" }] }];
  },
};

const router = createMemoryRouter([
  // A root route stays in the manifest. An unmatched navigation otherwise uses a shim route and crashes while reading its element.
  { path: "/", element: <main>Preview home</main> },
  { path: "/app/bundles", element: <main>Bundles</main> },
  {
    path: "/app/bundles/catalog",
    loader: ({ request }) => {
      const url = new URL(request.url);
      const imageProductId = url.searchParams.get("imageProductId");
      if (imageProductId) {
        const token = url.searchParams.get("token") ?? "";
        if (imageProductId === productId && url.searchParams.get("imageCursor") === "tee-2") {
          return {
            requestToken: token,
            productId: imageProductId,
            images: [{ url: "/fixtures/cap.png", alt: "Tee side" }],
            hasNextPage: false,
            endCursor: null,
            message: null,
          };
        }
        return { requestToken: token, productId: imageProductId, images: [], hasNextPage: false, endCursor: null, message: "This product is no longer available." };
      }
      const ids = new Set((url.searchParams.get("productIds") ?? "").split(",").filter(Boolean));
      const products = fixtureProducts.filter((item) => ids.has(item.id));
      const variants: Record<string, (typeof fixturePrices)[string]> = {};
      for (const item of products) {
        for (const variant of item.variants) {
          const price = fixturePrices[variant.id];
          if (price) variants[variant.id] = price;
        }
      }
      return { requestToken: url.searchParams.get("token") ?? "", products, priceBook: { currencyCode: "USD", variants }, message: null };
    },
  },
  {
    path: "/app/bundles/collections",
    loader: ({ request }) => {
      const url = new URL(request.url);
      const cursor = url.searchParams.get("cursor");
      const page = {
        collectionId: summerCollection,
        title: "Summer",
        products: cursor ? [] : [productB, productC],
        hasNextPage: false,
        endCursor: null,
      };
      return {
        requestToken: url.searchParams.get("token") ?? "",
        append: Boolean(cursor),
        pages: [page],
        page,
        message: null,
      };
    },
  },
  {
    path: "/app/bundles/images",
    action: async ({ request }) => {
      const form = await request.formData();
      const intent = String(form.get("intent") ?? "");
      if (intent === "resolve") return { ok: true, code: "resolved", files: [] };
      if (form.get("attempted") === "1") {
        return {
          ok: false,
          code: "permission_declined",
          state: "permission_declined",
          message: "File upload permission was declined. Catalog images still work.",
        };
      }
      return {
        ok: false,
        code: "permission_required",
        state: "permission_required",
        message: "Uploading a new image needs permission to add files in Shopify. This local preview cannot grant that permission.",
      };
    },
  },
  { path: "/app/bundles/:offerId", element: <BundleEditor offer={{
    offerId: "offer-1",
    status: "DRAFT",
    document: offerDocument,
    draftRevisionId: "revision-1",
    publishedRevisionId: null,
    storefrontActive: false,
    codFormActive: false,
    countryCode: "US",
  }} /> },
], { initialEntries: ["/app/bundles/offer-1"] });

const root = document.getElementById("root");
if (!root) throw new Error("Missing preview root.");
createRoot(root).render(<RouterProvider router={router} />);
