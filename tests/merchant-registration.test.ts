import { createServer } from "vite";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.COD_FORM_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COD_FORM_TEST_DATABASE_URL is required. Merchant registration tests cannot be skipped.");
}
const databaseHost = new URL(databaseUrl).hostname;
if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1" && databaseHost !== "::1") {
  throw new Error("Refusing to run merchant registration tests against a non-local database.");
}
process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const shops = ["phase1-a.myshopify.com", "phase1-b.myshopify.com"];

function adminFor(domain: string, shopifyShopId: string) {
  return {
    graphql: async () => ({
      json: async () => ({
        data: {
          shop: {
            id: `gid://shopify/Shop/${shopifyShopId}`,
            name: `${domain} store`,
            email: null,
            myshopifyDomain: domain,
            currencyCode: "PKR",
            ianaTimezone: "Asia/Karachi",
            plan: { publicDisplayName: "Basic" },
            shopAddress: { phone: null, countryCodeV2: "PK" },
          },
        },
      }),
    }),
  };
}

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  await prisma.session.deleteMany({ where: { shop: { in: shops } } });
  await prisma.shop.deleteMany({ where: { shopDomain: { in: shops } } });
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const merchant = await vite.ssrLoadModule("/app/models/merchant.server.ts");
  await cleanup();

  const first = await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 11n },
    admin: adminFor(shops[0], "900001"),
    reason: "auth",
  });
  const second = await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 11n },
    admin: adminFor(shops[0], "900001"),
    reason: "auth",
  });
  assert(first.id === second.id, "duplicate registration created a second shop");

  const [installs, logins, shopCount] = await Promise.all([
    prisma.loginHistory.count({ where: { shopId: first.id, eventType: "INSTALL" } }),
    prisma.loginHistory.count({ where: { shopId: first.id, eventType: "LOGIN" } }),
    prisma.shop.count({ where: { shopDomain: shops[0] } }),
  ]);
  assert(shopCount === 1, "shop count was not 1");
  assert(installs === 1, "install was not recorded once");
  assert(logins === 1, "second authentication was not recorded as login");

  await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 11n },
    admin: adminFor(shops[0], "900001"),
    reason: "access",
  });
  const refreshCount = await prisma.loginHistory.count({
    where: { shopId: first.id, shopifyUserId: "11", eventType: "APP_ACCESS" },
  });
  assert(refreshCount === 0, "page refresh recorded another history row");

  await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 22n },
    admin: adminFor(shops[0], "900001"),
    reason: "access",
  });
  await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 22n },
    admin: adminFor(shops[0], "900001"),
    reason: "access",
  });
  const staffAccessCount = await prisma.loginHistory.count({
    where: { shopId: first.id, shopifyUserId: "22", eventType: "APP_ACCESS" },
  });
  assert(staffAccessCount === 1, "staff access was not recorded once");

  await prisma.session.create({
    data: {
      id: "offline_phase1-a.myshopify.com",
      shop: shops[0],
      state: "state",
      isOnline: false,
      accessToken: "synthetic-session-token",
    },
  });
  const stored = await prisma.session.findUnique({
    where: { id: "offline_phase1-a.myshopify.com" },
    select: { shop: true, isOnline: true },
  });
  assert(stored?.shop === shops[0], "session storage row was not readable");

  await merchant.markShopUninstalled(shops[0]);
  await merchant.markShopUninstalled(shops[0]);
  const uninstalled = await prisma.shop.findUnique({ where: { shopDomain: shops[0] } });
  const uninstallEvents = await prisma.loginHistory.count({
    where: { shopId: first.id, eventType: "UNINSTALL" },
  });
  const sessionsLeft = await prisma.session.count({ where: { shop: shops[0] } });
  assert(uninstalled?.status === "UNINSTALLED", "shop was not marked uninstalled");
  assert(uninstalled?.uninstalledAt instanceof Date, "uninstall timestamp missing");
  assert(uninstallEvents === 1, "duplicate uninstall webhook created extra history");
  assert(sessionsLeft === 0, "sessions were not removed");

  const reinstalled = await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[0], userId: 11n },
    admin: adminFor(shops[0], "900001"),
    reason: "auth",
  });
  assert(reinstalled.id === first.id, "reinstall created a new shop");
  assert(reinstalled.status === "ACTIVE", "reinstall did not reactivate the shop");
  assert(reinstalled.uninstalledAt === null, "reinstall did not clear uninstalledAt");
  const reinstalls = await prisma.loginHistory.count({
    where: { shopId: first.id, eventType: "REINSTALL" },
  });
  assert(reinstalls === 1, "reinstall event missing");

  await merchant.registerAuthenticatedMerchant({
    session: { shop: shops[1], userId: 33n },
    admin: adminFor(shops[1], "900002"),
    reason: "auth",
  });
  const visibleToA = await prisma.shop.findMany({ where: { shopDomain: shops[0] } });
  assert(visibleToA.length === 1 && visibleToA[0].shopifyShopId === "900001", "merchant query leaked another shop");

  let mismatched = false;
  try {
    await merchant.registerAuthenticatedMerchant({
      session: { shop: shops[0], userId: 11n },
      admin: adminFor(shops[1], "900002"),
      reason: "access",
    });
  } catch {
    mismatched = true;
  }
  assert(mismatched, "mismatched shop profile was accepted");

  await merchant.redactShop(shops[1]);
  const redacted = await prisma.shop.count({ where: { shopDomain: shops[1] } });
  const redactedHistory = await prisma.loginHistory.count({
    where: { shop: { shopDomain: shops[1] } },
  });
  assert(redacted === 0 && redactedHistory === 0, "shop redact left merchant data behind");

  console.log(JSON.stringify({ ok: true }));
} finally {
  await cleanup();
  const remaining = await prisma.shop.count({ where: { shopDomain: { in: shops } } });
  console.log(JSON.stringify({ remainingTestShops: remaining }));
  await prisma.$disconnect();
  await vite.close();
}
