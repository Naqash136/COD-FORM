import { parseDecimal, promotionalCompareAt } from "../money";
import type { PriceBook } from "../pricing";

export type ShopifyImage = {
  url: string;
  alt: string | null;
};

export type NormalizedVariant = {
  id: string;
  title: string;
  selectedOptions: Array<{ name: string; value: string }>;
  image: ShopifyImage | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  catalogPrice: { amount: string; currencyCode: string } | null;
  compareAtPrice: { amount: string; currencyCode: string } | null;
  contextualPrice: { amount: string; currencyCode: string } | null;
  contextualCompareAtPrice: { amount: string; currencyCode: string } | null;
};

export type NormalizedProduct = {
  id: string;
  title: string;
  status: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNKNOWN";
  featuredImage: ShopifyImage | null;
  images: ShopifyImage[];
  imagesComplete: boolean;
  imagesCursor: string | null;
  options: Array<{ id: string; name: string; values: string[] }>;
  variants: NormalizedVariant[];
  variantsComplete: boolean;
};

export type CatalogMoney = { amount: string; currencyCode: string };

export function normalizeProduct(node: RawProduct, shopCurrency: string): NormalizedProduct {
  const images = (node.images?.nodes ?? []).flatMap((image) => (
    image.url ? [{ url: image.url, alt: image.altText ?? null }] : []
  ));
  const featured = node.featuredImage;
  const featuredImage = featured?.url ? { url: featured.url, alt: featured.altText ?? null } : images[0] ?? null;
  if (featuredImage && !images.some((image) => image.url === featuredImage.url)) images.unshift(featuredImage);
  return {
    id: node.id,
    title: node.title,
    status: normalizeStatus(node.status),
    featuredImage,
    images,
    imagesComplete: node.images?.pageInfo?.hasNextPage !== true,
    imagesCursor: node.images?.pageInfo?.endCursor ?? null,
    options: (node.options ?? []).map((option) => ({
      id: option.id,
      name: option.name,
      values: option.values ?? [],
    })),
    variants: (node.variants?.nodes ?? []).map((variant) => normalizeVariant(variant, shopCurrency)),
    variantsComplete: node.variants?.pageInfo?.hasNextPage !== true,
  };
}

export function normalizeVariant(variant: RawVariant, shopCurrency: string): NormalizedVariant {
  return {
    id: variant.id,
    title: variant.title,
    selectedOptions: variant.selectedOptions ?? [],
    image: variant.image?.url ? { url: variant.image.url, alt: variant.image.altText ?? null } : null,
    availableForSale: variant.availableForSale === true,
    inventoryQuantity: typeof variant.inventoryQuantity === "number" ? variant.inventoryQuantity : null,
    catalogPrice: variant.price ? { amount: variant.price, currencyCode: shopCurrency } : null,
    compareAtPrice: variant.compareAtPrice ? { amount: variant.compareAtPrice, currencyCode: shopCurrency } : null,
    contextualPrice: moneyV2(variant.contextualPricing?.price),
    contextualCompareAtPrice: moneyV2(variant.contextualPricing?.compareAtPrice),
  };
}

export function customerCanPurchase(product: NormalizedProduct, variant: NormalizedVariant) {
  return product.status === "ACTIVE" && variant.availableForSale;
}

export function priceBookFromProducts(
  products: NormalizedProduct[],
  countryCode: string | null,
  shopCurrency: string,
): { ok: true; book: PriceBook } | { ok: false; code: "missing_price" | "contextual_unavailable" | "mixed_currency" | "invalid_amount" } {
  const variants: PriceBook["variants"] = {};
  let currencyCode: string | null = null;
  for (const product of products) {
    for (const variant of product.variants) {
      const contextual = countryCode != null;
      const regular = contextual ? variant.contextualPrice : variant.catalogPrice;
      const compareAt = contextual ? variant.contextualCompareAtPrice : variant.compareAtPrice;
      if (contextual && variant.contextualPrice == null) return { ok: false, code: "contextual_unavailable" };
      if (!regular?.amount) return { ok: false, code: "missing_price" };
      const parsedRegular = parseDecimal(regular.amount, regular.currencyCode);
      if (!parsedRegular.ok) return { ok: false, code: parsedRegular.code === "unknown_currency" ? "invalid_amount" : "invalid_amount" };
      if (currencyCode && currencyCode !== parsedRegular.value.currencyCode) return { ok: false, code: "mixed_currency" };
      currencyCode = parsedRegular.value.currencyCode;
      let compare: PriceBook["variants"][string]["compareAt"] = null;
      if (compareAt?.amount) {
        const parsedCompare = parseDecimal(compareAt.amount, compareAt.currencyCode);
        if (!parsedCompare.ok) return { ok: false, code: "invalid_amount" };
        if (parsedCompare.value.currencyCode !== currencyCode) return { ok: false, code: "mixed_currency" };
        compare = promotionalCompareAt(parsedCompare.value, parsedRegular.value);
      }
      variants[variant.id] = {
        regular: parsedRegular.value,
        compareAt: compare,
        available: customerCanPurchase(product, variant),
      };
    }
  }
  if (!currencyCode) return { ok: true, book: { currencyCode: shopCurrency, variants } };
  return { ok: true, book: { currencyCode, variants } };
}

export function acceptFreshResponse<T extends { requestToken: string }>(currentToken: string, response: T) {
  if (response.requestToken !== currentToken) return { ok: false as const, code: "stale_response" as const };
  return { ok: true as const, response };
}

function moneyV2(value: { amount?: string | null; currencyCode?: string | null } | null | undefined): CatalogMoney | null {
  if (!value?.amount || !value.currencyCode) return null;
  return { amount: value.amount, currencyCode: value.currencyCode };
}

function normalizeStatus(status: string | null | undefined): NormalizedProduct["status"] {
  if (status === "ACTIVE" || status === "DRAFT" || status === "ARCHIVED") return status;
  return "UNKNOWN";
}

export type RawVariant = {
  id: string;
  title: string;
  availableForSale?: boolean;
  inventoryQuantity?: number | null;
  price?: string | null;
  compareAtPrice?: string | null;
  selectedOptions?: Array<{ name: string; value: string }>;
  image?: { url?: string | null; altText?: string | null } | null;
  contextualPricing?: {
    price?: { amount?: string | null; currencyCode?: string | null } | null;
    compareAtPrice?: { amount?: string | null; currencyCode?: string | null } | null;
  } | null;
};

export type RawProduct = {
  id: string;
  title: string;
  status?: string | null;
  featuredImage?: { url?: string | null; altText?: string | null } | null;
  options?: Array<{ id: string; name: string; values?: string[] }>;
  images?: {
    nodes?: Array<{ url?: string | null; altText?: string | null }>;
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
  };
  variants?: { nodes?: RawVariant[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } };
};
