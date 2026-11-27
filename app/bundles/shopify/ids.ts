const PRODUCT_GID = /^gid:\/\/shopify\/Product\/\d+$/;
const VARIANT_GID = /^gid:\/\/shopify\/ProductVariant\/\d+$/;
const COLLECTION_GID = /^gid:\/\/shopify\/Collection\/\d+$/;
const COUNTRY_CODE = /^[A-Z]{2}$/;

export function isProductGid(value: string) {
  return PRODUCT_GID.test(value);
}

export function isVariantGid(value: string) {
  return VARIANT_GID.test(value);
}

export function isCollectionGid(value: string) {
  return COLLECTION_GID.test(value);
}

export function isCountryCode(value: string) {
  return COUNTRY_CODE.test(value);
}

export function sameShop(sessionShop: string, claimedShop: string | null | undefined) {
  if (claimedShop == null || claimedShop === "") return true;
  return sessionShop.trim().toLowerCase() === claimedShop.trim().toLowerCase();
}

export function inventoryPermitted(scopes: readonly string[]) {
  return scopes.some((scope) => scope === "read_inventory" || scope === "write_inventory");
}
