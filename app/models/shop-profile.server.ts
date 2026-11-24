import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

const SHOP_PROFILE_QUERY = `#graphql
  query ShopProfile {
    shop {
      id
      name
      email
      myshopifyDomain
      currencyCode
      ianaTimezone
      plan {
        publicDisplayName
      }
      shopAddress {
        phone
        countryCodeV2
      }
    }
  }
`;

export type ShopProfile = {
  shopifyShopId: string;
  shopDomain: string;
  shopName: string;
  email: string | null;
  ownerName: string | null;
  phone: string | null;
  countryCode: string | null;
  currency: string;
  timezone: string;
  shopifyPlan: string | null;
};

type ShopProfileResponse = {
  data?: {
    shop?: {
      id?: string | null;
      name?: string | null;
      email?: string | null;
      myshopifyDomain?: string | null;
      currencyCode?: string | null;
      ianaTimezone?: string | null;
      plan?: { publicDisplayName?: string | null } | null;
      shopAddress?: {
        phone?: string | null;
        countryCodeV2?: string | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

function emptyToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function shopifyShopIdFromGid(gid: string) {
  const id = gid.split("/").filter(Boolean).pop();
  if (!id || !/^\d+$/.test(id)) {
    throw new Error("Shopify shop id was not a numeric store id");
  }
  return id;
}

export async function fetchShopProfile(
  admin: Pick<AdminApiContext, "graphql">,
  authenticatedShop: string,
): Promise<ShopProfile> {
  const response = await admin.graphql(SHOP_PROFILE_QUERY);
  const body = (await response.json()) as ShopProfileResponse;

  if (body.errors?.length) {
    throw new Error("Shopify shop profile query failed");
  }

  const shop = body.data?.shop;
  const shopDomain = emptyToNull(shop?.myshopifyDomain);
  const shopName = emptyToNull(shop?.name);
  const currency = emptyToNull(shop?.currencyCode);
  const timezone = emptyToNull(shop?.ianaTimezone);
  const gid = emptyToNull(shop?.id);

  if (!shop || !gid || !shopDomain || !shopName || !currency || !timezone) {
    throw new Error("Shopify shop profile was incomplete");
  }

  if (shopDomain !== authenticatedShop) {
    const error = new Error("Shopify shop profile did not match the authenticated shop");
    error.name = "ShopDomainMismatchError";
    throw error;
  }

  return {
    shopifyShopId: shopifyShopIdFromGid(gid),
    shopDomain,
    shopName,
    email: emptyToNull(shop.email),
    ownerName: null,
    phone: emptyToNull(shop.shopAddress?.phone),
    countryCode: emptyToNull(shop.shopAddress?.countryCodeV2),
    currency,
    timezone,
    shopifyPlan: emptyToNull(shop.plan?.publicDisplayName),
  };
}
