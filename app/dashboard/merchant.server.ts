import prisma from "../db.server";
import { isDevelopmentPlan } from "./presentation";
import { authenticate } from "../shopify.server";

export type MerchantView = {
  registered: boolean;
  shopName: string;
  shopDomain: string;
  currency: string | null;
  timezone: string | null;
  plan: string | null;
  email: string | null;
  countryCode: string | null;
  developmentStore: boolean;
};

export async function loadMerchantView(request: Request): Promise<MerchantView> {
  const { session } = await authenticate.admin(request);
  const shop = await prisma.shop.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!shop || shop.status !== "ACTIVE") {
    return {
      registered: false,
      shopName: session.shop,
      shopDomain: session.shop,
      currency: shop?.currency ?? null,
      timezone: shop?.timezone ?? null,
      plan: shop?.shopifyPlan ?? null,
      email: shop?.email ?? null,
      countryCode: shop?.countryCode ?? null,
      developmentStore: isDevelopmentPlan(shop?.shopifyPlan),
    };
  }

  return {
    registered: true,
    shopName: shop.shopName,
    shopDomain: shop.shopDomain,
    currency: shop.currency,
    timezone: shop.timezone,
    plan: shop.shopifyPlan,
    email: shop.email,
    countryCode: shop.countryCode,
    developmentStore: isDevelopmentPlan(shop.shopifyPlan),
  };
}
