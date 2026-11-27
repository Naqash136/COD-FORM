import { normalizeProduct, normalizeVariant, type NormalizedProduct, type RawProduct, type RawVariant } from "./catalog";
import { adminQuery, type AdminGraphql } from "./admin";
import { inventoryPermitted, isCountryCode, isProductGid, sameShop } from "./ids";
import {
  BUNDLE_PRODUCT_IMAGES_QUERY,
  BUNDLE_PRODUCTS_CONTEXT_QUERY,
  BUNDLE_PRODUCTS_QUERY,
  BUNDLE_VARIANT_PAGE_CONTEXT_QUERY,
  BUNDLE_VARIANT_PAGE_QUERY,
} from "./queries";

const VARIANT_PAGE_LIMIT = 10;

export type ProductCatalogResult = {
  requestToken: string;
  shopCurrency: string;
  inventory: "permitted" | "missing_scope";
  products: NormalizedProduct[];
  missingIds: string[];
  complete: boolean;
  truncatedProductIds: string[];
};

type ProductNode = RawProduct & { __typename?: string };
type ProductsData = {
  shop?: { currencyCode?: string | null } | null;
  nodes?: Array<ProductNode | null>;
};
type VariantPageData = {
  product?: { variants?: { nodes?: RawVariant[]; pageInfo?: { hasNextPage: boolean; endCursor: string | null } } } | null;
};

export async function loadProductsForMerchant(
  admin: AdminGraphql,
  input: {
    sessionShop: string;
    claimedShop?: string | null;
    productIds: string[];
    countryCode?: string | null;
    requestToken: string;
    scopes: readonly string[];
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ ok: true; catalog: ProductCatalogResult } | { ok: false; code: "cross_merchant" | "invalid_id" | "invalid_country" | "graphql_error" | "throttled" | "invalid_response"; message?: string }> {
  if (!sameShop(input.sessionShop, input.claimedShop)) return { ok: false, code: "cross_merchant" };
  if (input.productIds.some((id) => !isProductGid(id))) return { ok: false, code: "invalid_id" };
  const countryCode = input.countryCode ?? null;
  if (countryCode && !isCountryCode(countryCode)) return { ok: false, code: "invalid_country" };
  if (input.productIds.length === 0) {
    return {
      ok: true,
      catalog: {
        requestToken: input.requestToken,
        shopCurrency: "",
        products: [],
        missingIds: [],
        inventory: inventoryState(input.scopes),
        complete: true,
        truncatedProductIds: [],
      },
    };
  }

  const queried = await adminQuery<ProductsData>(
    admin,
    countryCode ? BUNDLE_PRODUCTS_CONTEXT_QUERY : BUNDLE_PRODUCTS_QUERY,
    countryCode ? { ids: input.productIds, country: countryCode } : { ids: input.productIds },
    input.sleep,
  );
  if (!queried.ok) return queried;
  const shopCurrency = queried.data.shop?.currencyCode ?? "";
  if (!shopCurrency) return { ok: false, code: "invalid_response", message: "Shopify did not return a shop currency." };
  const nodes = queried.data.nodes ?? [];
  const products: NormalizedProduct[] = [];
  const missingIds: string[] = [];
  input.productIds.forEach((id, index) => {
    const node = nodes[index];
    if (!node || node.__typename !== "Product") {
      missingIds.push(id);
      return;
    }
    products.push(normalizeProduct(node, shopCurrency));
  });

  const truncatedProductIds: string[] = [];
  for (const product of products) {
    let page = nodePage(nodes, product.id);
    let pages = 0;
    let truncated = false;
    while (page?.hasNextPage && page.endCursor && pages < VARIANT_PAGE_LIMIT) {
      const next = await adminQuery<VariantPageData>(
        admin,
        countryCode ? BUNDLE_VARIANT_PAGE_CONTEXT_QUERY : BUNDLE_VARIANT_PAGE_QUERY,
        countryCode ? { id: product.id, cursor: page.endCursor, country: countryCode } : { id: product.id, cursor: page.endCursor },
        input.sleep,
      );
      if (!next.ok) return next;
      const connection = next.data.product?.variants;
      if (!connection?.pageInfo) {
        truncated = true;
        break;
      }
      product.variants.push(...(connection.nodes ?? []).map((variant) => normalizeVariant(variant, shopCurrency)));
      page = connection.pageInfo;
      pages += 1;
    }
    if (page?.hasNextPage === true) truncated = true;
    product.variantsComplete = !truncated;
    if (truncated) truncatedProductIds.push(product.id);
  }

  return {
    ok: true,
    catalog: {
      requestToken: input.requestToken,
      shopCurrency,
      inventory: inventoryState(input.scopes),
      products,
      missingIds,
      complete: truncatedProductIds.length === 0,
      truncatedProductIds,
    },
  };
}

type ImagePageData = {
  product?: {
    id?: string | null;
    images?: {
      nodes?: Array<{ url?: string | null; altText?: string | null } | null>;
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    } | null;
  } | null;
};

export async function loadProductImages(
  admin: AdminGraphql,
  input: {
    sessionShop: string;
    claimedShop?: string | null;
    productId: string;
    cursor?: string | null;
    requestToken: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<
  | { ok: true; requestToken: string; productId: string; images: Array<{ url: string; alt: string | null }>; hasNextPage: boolean; endCursor: string | null; unavailable: boolean }
  | { ok: false; code: "cross_merchant" | "invalid_id" | "graphql_error" | "throttled" | "invalid_response"; message?: string }
> {
  if (!sameShop(input.sessionShop, input.claimedShop)) return { ok: false, code: "cross_merchant" };
  if (!isProductGid(input.productId)) return { ok: false, code: "invalid_id" };
  const queried = await adminQuery<ImagePageData>(
    admin,
    BUNDLE_PRODUCT_IMAGES_QUERY,
    { id: input.productId, after: input.cursor || null },
    input.sleep,
  );
  if (!queried.ok) return queried;
  const product = queried.data.product;
  if (!product?.id) {
    return { ok: true, requestToken: input.requestToken, productId: input.productId, images: [], hasNextPage: false, endCursor: null, unavailable: true };
  }
  const images = (product.images?.nodes ?? []).flatMap((image) => (
    image?.url ? [{ url: image.url, alt: image.altText ?? null }] : []
  ));
  return {
    ok: true,
    requestToken: input.requestToken,
    productId: product.id,
    images,
    hasNextPage: product.images?.pageInfo?.hasNextPage === true,
    endCursor: product.images?.pageInfo?.endCursor ?? null,
    unavailable: false,
  };
}

function inventoryState(scopes: readonly string[]): "permitted" | "missing_scope" {
  return inventoryPermitted(scopes) ? "permitted" : "missing_scope";
}

function nodePage(nodes: Array<ProductNode | null>, productId: string) {
  const node = nodes.find((item) => item?.id === productId);
  return node?.variants?.pageInfo ?? null;
}
