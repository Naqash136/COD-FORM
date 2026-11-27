import { adminQuery, type AdminGraphql } from "./admin";
import { isCollectionGid, isProductGid, isVariantGid, sameShop } from "./ids";
import { loadProductsForMerchant } from "./products.server";
import { BUNDLE_COLLECTION_MEMBERSHIP_QUERY, BUNDLE_COLLECTION_PRODUCTS_QUERY } from "./queries";
import type { VerifiedCollectionMembership } from "../pricing";

export type CollectionProductPage = {
  requestToken: string;
  collectionId: string;
  title: string;
  products: Array<{
    id: string;
    title: string;
    status: string;
    featuredImageUrl: string | null;
    featuredImageAlt: string | null;
    variants: Array<{ id: string; title: string; availableForSale: boolean }>;
    variantsComplete: boolean;
  }>;
  hasNextPage: boolean;
  endCursor: string | null;
};

type CollectionProductsData = {
  collection?: {
    id: string;
    title: string;
    products?: {
      pageInfo?: { hasNextPage: boolean; endCursor: string | null };
      nodes?: Array<{
        id: string;
        title: string;
        status?: string | null;
        featuredImage?: { url?: string | null; altText?: string | null } | null;
        variants?: {
          pageInfo?: { hasNextPage: boolean };
          nodes?: Array<{ id: string; title: string; availableForSale?: boolean }>;
        };
      }>;
    };
  } | null;
};

type MembershipData = {
  collection?: { id: string; hasProduct: boolean } | null;
};

export async function listCollectionProducts(
  admin: AdminGraphql,
  input: {
    sessionShop: string;
    claimedShop?: string | null;
    collectionId: string;
    cursor?: string | null;
    requestToken: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ ok: true; page: CollectionProductPage } | { ok: false; code: "cross_merchant" | "invalid_id" | "missing_collection" | "graphql_error" | "throttled" | "invalid_response"; message?: string }> {
  if (!sameShop(input.sessionShop, input.claimedShop)) return { ok: false, code: "cross_merchant" };
  if (!isCollectionGid(input.collectionId)) return { ok: false, code: "invalid_id" };
  const queried = await adminQuery<CollectionProductsData>(
    admin,
    BUNDLE_COLLECTION_PRODUCTS_QUERY,
    { id: input.collectionId, cursor: input.cursor ?? null },
    input.sleep,
  );
  if (!queried.ok) return queried;
  const collection = queried.data.collection;
  if (!collection) return { ok: false, code: "missing_collection" };
  return {
    ok: true,
    page: {
      requestToken: input.requestToken,
      collectionId: collection.id,
      title: collection.title,
      products: (collection.products?.nodes ?? []).map((product) => ({
        id: product.id,
        title: product.title,
        status: product.status ?? "UNKNOWN",
        featuredImageUrl: product.featuredImage?.url ?? null,
        featuredImageAlt: product.featuredImage?.altText ?? null,
        variants: (product.variants?.nodes ?? []).map((variant) => ({
          id: variant.id,
          title: variant.title,
          availableForSale: variant.availableForSale === true,
        })),
        variantsComplete: product.variants?.pageInfo?.hasNextPage !== true,
      })),
      hasNextPage: collection.products?.pageInfo?.hasNextPage === true,
      endCursor: collection.products?.pageInfo?.endCursor ?? null,
    },
  };
}

export async function verifyCollectionMembership(
  admin: AdminGraphql,
  input: {
    sessionShop: string;
    claimedShop?: string | null;
    collectionId: string;
    productId: string;
    variantIds: string[];
    requestToken: string;
    sleep?: (ms: number) => Promise<void>;
  },
  ): Promise<{ ok: true; membership: VerifiedCollectionMembership & { requestToken: string } } | { ok: false; code: "cross_merchant" | "invalid_id" | "invalid_country" | "not_member" | "variant_not_allowed" | "incomplete_catalog" | "missing_collection" | "graphql_error" | "throttled" | "invalid_response"; message?: string }> {
  if (!sameShop(input.sessionShop, input.claimedShop)) return { ok: false, code: "cross_merchant" };
  if (!isCollectionGid(input.collectionId) || !isProductGid(input.productId) || input.variantIds.some((id) => !isVariantGid(id))) {
    return { ok: false, code: "invalid_id" };
  }
  const membership = await adminQuery<MembershipData>(
    admin,
    BUNDLE_COLLECTION_MEMBERSHIP_QUERY,
    { id: input.collectionId, productId: input.productId },
    input.sleep,
  );
  if (!membership.ok) return membership;
  if (!membership.data.collection) return { ok: false, code: "missing_collection" };
  if (!membership.data.collection.hasProduct) return { ok: false, code: "not_member" };
  const products = await loadProductsForMerchant(admin, {
    sessionShop: input.sessionShop,
    productIds: [input.productId],
    requestToken: input.requestToken,
    scopes: [],
    sleep: input.sleep,
  });
  if (!products.ok) return products;
  const product = products.catalog.products[0];
  if (!product) return { ok: false, code: "not_member" };
  const known = new Set(product.variants.map((variant) => variant.id));
  if (input.variantIds.some((id) => !known.has(id))) {
    if (!products.catalog.complete || !product.variantsComplete) {
      return { ok: false, code: "incomplete_catalog", message: "Shopify did not return every variant, so membership was not decided." };
    }
    return { ok: false, code: "variant_not_allowed" };
  }
  return {
    ok: true,
    membership: {
      requestToken: input.requestToken,
      collectionId: input.collectionId,
      productId: input.productId,
      variantIds: input.variantIds,
    },
  };
}
