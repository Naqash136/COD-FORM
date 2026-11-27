import type { LoaderFunctionArgs } from "react-router";
import { priceBookFromProducts, type NormalizedProduct } from "../bundles/shopify/catalog";
import { formatDecimal } from "../bundles/money";
import type { JsonPriceBook, PreviewProduct } from "../bundles/editor-state";
import { isProductGid } from "../bundles/shopify/ids";
import { loadProductImages, loadProductsForMerchant } from "../bundles/shopify/products.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const country = url.searchParams.get("country") ?? "";
  const requestToken = url.searchParams.get("token") ?? "";
  const imageProductId = url.searchParams.get("imageProductId") ?? "";
  if (imageProductId) {
    if (!isProductGid(imageProductId)) {
      return { requestToken, productId: imageProductId, images: [], hasNextPage: false, endCursor: null, message: "Shopify could not load more images." };
    }
    const page = await loadProductImages(admin, {
      sessionShop: session.shop,
      productId: imageProductId,
      cursor: url.searchParams.get("imageCursor"),
      requestToken,
    });
    if (!page.ok || page.unavailable) {
      return { requestToken, productId: imageProductId, images: [], hasNextPage: false, endCursor: null, message: "This product is no longer available." };
    }
    const message = page.hasNextPage ? "Shopify has more images for this product." : null;
    return { requestToken, productId: page.productId, images: page.images, hasNextPage: page.hasNextPage, endCursor: page.endCursor, message };
  }
  const productIds = [...new Set((url.searchParams.get("productIds") ?? url.searchParams.get("productId") ?? "").split(",").map((id) => id.trim()).filter(Boolean))];
  if (productIds.length === 0) {
    return { requestToken, products: [], priceBook: null, message: null };
  }
  const loaded = await loadProductsForMerchant(admin, {
    sessionShop: session.shop,
    productIds,
    countryCode: country || null,
    requestToken,
    scopes: String(session.scope ?? "").split(",").filter(Boolean),
  });
  if (!loaded.ok) {
    return { requestToken, products: [], priceBook: null, message: "Shopify could not load this product." };
  }
  if (loaded.catalog.products.length === 0) {
    return { requestToken, products: [], priceBook: null, message: "This product is no longer available." };
  }
  const incomplete = loaded.catalog.products.filter((product) => !product.variantsComplete).map((product) => product.id);
  const moreImages = loaded.catalog.products.some((product) => !product.imagesComplete);
  const priced = priceBookFromProducts(loaded.catalog.products, country || null, loaded.catalog.shopCurrency);
  const incompleteMessage = [
    incomplete.length > 0 ? "Shopify did not return every variant for one or more products." : null,
    moreImages ? "Shopify has more images for one or more products." : null,
  ].filter(Boolean).join(" ") || null;
  return {
    requestToken,
    products: loaded.catalog.products.map((product) => presentProduct(product, priced.ok ? priced.book : null)),
    priceBook: priced.ok ? jsonBook(priced.book) : null,
    message: priced.ok ? incompleteMessage : [previewMessage(priced.code), incompleteMessage].filter(Boolean).join(" "),
  };
}

function presentProduct(product: NormalizedProduct, book: { variants: Record<string, { regular: { amountMinor: bigint; currencyCode: string; exponent: number } | null; compareAt: { amountMinor: bigint; currencyCode: string; exponent: number } | null }> } | null): PreviewProduct {
  return {
    id: product.id,
    title: product.title,
    status: product.status,
    featuredImageUrl: product.featuredImage?.url ?? null,
    featuredImageAlt: product.featuredImage?.alt ?? null,
    images: product.images,
    imagesComplete: product.imagesComplete,
    imagesCursor: product.imagesCursor,
    variantsComplete: product.variantsComplete,
    variants: product.variants.map((variant) => {
      const point = book?.variants[variant.id];
      return {
        id: variant.id,
        title: variant.title,
        availableForSale: variant.availableForSale,
        regularLabel: point?.regular ? `${formatDecimal(point.regular)} ${point.regular.currencyCode}` : null,
        compareLabel: point?.compareAt ? `${formatDecimal(point.compareAt)} ${point.compareAt.currencyCode}` : null,
      };
    }),
  };
}

function jsonBook(book: { currencyCode: string; variants: Record<string, { regular: { amountMinor: bigint; currencyCode: string; exponent: number } | null; compareAt: { amountMinor: bigint; currencyCode: string; exponent: number } | null; available: boolean }> }): JsonPriceBook {
  return {
    currencyCode: book.currencyCode,
    variants: Object.fromEntries(Object.entries(book.variants).map(([id, point]) => [id, {
      available: point.available,
      regular: point.regular ? { amountMinor: point.regular.amountMinor.toString(), currencyCode: point.regular.currencyCode, exponent: point.regular.exponent } : null,
      compareAt: point.compareAt ? { amountMinor: point.compareAt.amountMinor.toString(), currencyCode: point.compareAt.currencyCode, exponent: point.compareAt.exponent } : null,
    }])),
  };
}

function previewMessage(code: string) {
  if (code === "contextual_unavailable") return "Shopify did not return a price for this country.";
  if (code === "missing_price") return "Shopify did not return a price for this product.";
  if (code === "mixed_currency") return "Shopify returned prices in more than one currency.";
  return "This product price could not be used.";
}
