import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import { LoginEventType, type Prisma, ShopStatus } from "@prisma/client";

import prisma from "../db.server";
import { fetchShopProfile, type ShopProfile } from "./shop-profile.server";

const APP_ACCESS_WINDOW_MS = 6 * 60 * 60 * 1000;
const transactionOptions = { maxWait: 15_000, timeout: 30_000 };

type MerchantSession = {
  shop: string;
  userId?: bigint | number | string | null;
};

type RegistrationReason = "auth" | "access";

function shopifyUserIdFromSession(session: MerchantSession) {
  if (session.userId == null || session.userId === "") return null;
  return session.userId.toString();
}

function profileData(profile: ShopProfile): Prisma.ShopUpdateInput {
  return {
    shopifyShopId: profile.shopifyShopId,
    shopDomain: profile.shopDomain,
    shopName: profile.shopName,
    email: profile.email,
    ownerName: profile.ownerName,
    phone: profile.phone,
    countryCode: profile.countryCode,
    currency: profile.currency,
    timezone: profile.timezone,
    shopifyPlan: profile.shopifyPlan,
  };
}

async function hasRecentAccess(
  tx: Prisma.TransactionClient,
  shopId: string,
  shopifyUserId: string | null,
) {
  const recent = await tx.loginHistory.findFirst({
    where: {
      shopId,
      shopifyUserId,
      eventType: { in: [LoginEventType.LOGIN, LoginEventType.APP_ACCESS, LoginEventType.INSTALL, LoginEventType.REINSTALL] },
      createdAt: { gte: new Date(Date.now() - APP_ACCESS_WINDOW_MS) },
    },
    select: { id: true },
  });
  return Boolean(recent);
}

async function writeMerchantEvent(
  tx: Prisma.TransactionClient,
  shopId: string,
  shopifyUserId: string | null,
  eventType: LoginEventType,
) {
  await tx.loginHistory.create({
    data: { shopId, shopifyUserId, eventType },
  });
}

async function persistMerchant(
  profile: ShopProfile,
  shopifyUserId: string | null,
  reason: RegistrationReason,
) {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const existing =
      (await tx.shop.findUnique({ where: { shopifyShopId: profile.shopifyShopId } })) ??
      (await tx.shop.findUnique({ where: { shopDomain: profile.shopDomain } }));

    if (!existing) {
      const shop = await tx.shop.create({
        data: {
          ...profileData(profile),
          status: ShopStatus.ACTIVE,
          installedAt: now,
          lastInstalledAt: now,
          lastLoginAt: now,
        } as Prisma.ShopCreateInput,
      });
      await writeMerchantEvent(
        tx,
        shop.id,
        shopifyUserId,
        reason === "auth" ? LoginEventType.INSTALL : LoginEventType.APP_ACCESS,
      );
      return shop;
    }

    const reinstall = existing.status === ShopStatus.UNINSTALLED;
    let eventType: LoginEventType | null = null;

    if (reinstall) {
      eventType = LoginEventType.REINSTALL;
    } else if (reason === "auth") {
      eventType = LoginEventType.LOGIN;
    } else if (!(await hasRecentAccess(tx, existing.id, shopifyUserId))) {
      eventType = LoginEventType.APP_ACCESS;
    }

    const shop = await tx.shop.update({
      where: { id: existing.id },
      data: {
        ...profileData(profile),
        status: ShopStatus.ACTIVE,
        ...(reinstall
          ? { lastInstalledAt: now, uninstalledAt: null }
          : {}),
        ...(eventType ? { lastLoginAt: now } : {}),
      },
    });

    if (eventType) {
      await writeMerchantEvent(tx, shop.id, shopifyUserId, eventType);
    }

    return shop;
  }, transactionOptions);
}

export async function registerAuthenticatedMerchant(args: {
  session: MerchantSession;
  admin: Pick<AdminApiContext, "graphql">;
  reason: RegistrationReason;
}) {
  const shopifyUserId = shopifyUserIdFromSession(args.session);
  let profile: ShopProfile;

  try {
    profile = await fetchShopProfile(args.admin, args.session.shop);
  } catch (error) {
    const domainMismatch = error instanceof Error && error.name === "ShopDomainMismatchError";
    if (args.reason !== "access" || domainMismatch) throw error;
    const existing = await prisma.shop.findUnique({
      where: { shopDomain: args.session.shop },
    });
    if (!existing || existing.status !== ShopStatus.ACTIVE) throw error;
    return persistKnownShopAccess(existing.id, shopifyUserId);
  }

  try {
    return await persistMerchant(profile, shopifyUserId, args.reason);
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return persistMerchant(profile, shopifyUserId, args.reason);
    }
    throw error;
  }
}

async function persistKnownShopAccess(shopId: string, shopifyUserId: string | null) {
  return prisma.$transaction(async (tx) => {
    const recordAccess = !(await hasRecentAccess(tx, shopId, shopifyUserId));
    const shop = await tx.shop.update({
      where: { id: shopId },
      data: recordAccess ? { lastLoginAt: new Date() } : {},
    });
    if (recordAccess) {
      await writeMerchantEvent(tx, shopId, shopifyUserId, LoginEventType.APP_ACCESS);
    }
    return shop;
  }, transactionOptions);
}

export async function markShopUninstalled(shopDomain: string) {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { shop: shopDomain } });

    const shop = await tx.shop.findUnique({ where: { shopDomain } });
    if (!shop) return;

    const uninstallAlreadyRecorded = await tx.loginHistory.findFirst({
      where: {
        shopId: shop.id,
        eventType: LoginEventType.UNINSTALL,
        createdAt: { gte: shop.lastInstalledAt },
      },
      select: { id: true },
    });

    await tx.shop.update({
      where: { id: shop.id },
      data: {
        status: ShopStatus.UNINSTALLED,
        uninstalledAt: shop.uninstalledAt ?? new Date(),
      },
    });

    if (!uninstallAlreadyRecorded) {
      await writeMerchantEvent(tx, shop.id, null, LoginEventType.UNINSTALL);
    }
  }, transactionOptions);
}

export async function redactShop(shopDomain: string) {
  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { shop: shopDomain } });
    await tx.shop.deleteMany({ where: { shopDomain } });
  }, transactionOptions);
}
