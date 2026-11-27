import assert from "node:assert/strict";
import { createServer } from "vite";

const databaseUrl = process.env.COD_FORM_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("COD_FORM_TEST_DATABASE_URL is required. Bundle database tests cannot be skipped.");
}

const host = new URL(databaseUrl).hostname;
if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
  throw new Error("Refusing to run bundle repository tests against a non-local database.");
}

const { PrismaClient } = await import("@prisma/client");
const { execFileSync } = await import("node:child_process");

execFileSync("npx", ["prisma", "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
  stdio: "inherit",
});

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const repository = await vite.ssrLoadModule("/app/bundles/repository.server.ts");

function emptyOffer(name = "Repository offer") {
  return {
    schemaVersion: 1,
    name,
    products: { items: [] as unknown[] },
    settings: { extensions: null },
    style: { extensions: null },
    bars: [] as unknown[],
    modal: { extensions: null },
    targeting: { productIds: [] as string[], collectionIds: [] as string[] },
    extensions: null,
  };
}

function assertOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  assert.equal(result.ok, true);
}

const shopA = crypto.randomUUID();
const shopB = crypto.randomUUID();
const createdShops = [shopA, shopB];

try {
  await prisma.shop.create({
    data: {
      id: shopA,
      shopifyShopId: `test-${shopA}`,
      shopDomain: `${shopA}.example.com`,
      shopName: "Bundle test A",
      currency: "USD",
      timezone: "UTC",
    },
  });
  await prisma.shop.create({
    data: {
      id: shopB,
      shopifyShopId: `test-${shopB}`,
      shopDomain: `${shopB}.example.com`,
      shopName: "Bundle test B",
      currency: "USD",
      timezone: "UTC",
    },
  });

  const created = await repository.createBundleOffer(shopA, emptyOffer(), prisma);
  assertOk(created);
  const read = await repository.readBundleOffer(shopA, created.offerId, prisma);
  assert.equal(read?.draft?.valid, true);
  assert.equal(await repository.readBundleOffer(shopB, created.offerId, prisma), null);

  const listed = await repository.listBundleOffers(shopA, prisma);
  assert.equal(listed.some((offer: { id: string }) => offer.id === created.offerId), true);
  assert.equal((await repository.listBundleOffers(shopB, prisma)).length, 0);

  const saved = await repository.saveBundleDraft(shopA, created.offerId, emptyOffer("Saved"), created.revisionId, prisma);
  assertOk(saved);
  const conflict = await repository.saveBundleDraft(shopA, created.offerId, emptyOffer("Stale"), created.revisionId, prisma);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, "conflict");
  assert.equal((await repository.saveBundleDraft(shopB, created.offerId, emptyOffer("Other"), saved.revisionId, prisma)).code, "not_found");

  const withBar = emptyOffer("Published");
  withBar.bars = [{
    id: "qty",
    type: "quantity_break",
    title: "Four",
    subtitle: "",
    label: "",
    textTemplate: "",
    selectedByDefault: true,
    pricing: { mode: "full_price" },
    images: {
      customBarImage: { source: "catalog", productId: "gid://shopify/Product/1", url: "https://cdn.shopify.com/bar.png", alt: "Bar" },
      featuredImage: { source: "catalog", productId: "gid://shopify/Product/1", url: "https://cdn.shopify.com/feature.png", alt: "Feature" },
      barImageSize: 48,
      barImageRadius: 6,
    },
    upsells: [],
    gifts: { selection: "single", items: [] },
    freeShipping: { enabled: false, maximumRate: null },
    personalisation: { enabled: false, perUnit: false, fields: [] },
    highlights: [],
    soldOut: { appearance: "hide", restrictSelection: true },
    extensions: null,
    config: {
      product: {
        productId: "gid://shopify/Product/1",
        allowedVariantIds: ["gid://shopify/ProductVariant/1"],
        selectedVariantId: "gid://shopify/ProductVariant/1",
      },
      quantity: 4,
      quantitySelector: false,
    },
  }];
  const publishable = await repository.saveBundleDraft(shopA, created.offerId, withBar, saved.revisionId, prisma);
  assertOk(publishable);
  const published = await repository.publishBundleRevision(shopA, created.offerId, publishable.revisionId, prisma);
  assertOk(published);
  assert.equal(published.status, "PUBLISHED");
  const publishedOffer = await repository.readBundleOffer(shopA, created.offerId, prisma);
  assert.equal(publishedOffer?.status, "PUBLISHED");
  assert.equal(publishedOffer?.storefrontActive, false);
  assert.equal(publishedOffer?.codFormActive, false);
  assert.equal((await repository.publishBundleRevision(shopB, created.offerId, publishable.revisionId, prisma)).code, "not_found");
  const publishedRow = await prisma.bundleRevision.findUnique({ where: { id: publishable.revisionId } });
  const clearedBar = JSON.parse(JSON.stringify(withBar)) as { bars: Array<{ images: { customBarImage: { url: string } | null } }> };
  clearedBar.bars[0]!.images.customBarImage = null;
  const clearedDraft = await repository.saveBundleDraft(shopA, created.offerId, clearedBar, publishedOffer.draftRevisionId, prisma);
  assertOk(clearedDraft);
  const publishedAfterDelete = await prisma.bundleRevision.findUnique({ where: { id: publishable.revisionId } });
  const publishedImages = (publishedAfterDelete?.document as { bars?: Array<{ images?: { customBarImage?: { url?: string }; featuredImage?: { url?: string } } }> } | null)?.bars?.[0]?.images;
  const originalImages = (publishedRow?.document as { bars?: Array<{ images?: { featuredImage?: { url?: string } } }> } | null)?.bars?.[0]?.images;
  assert.equal(publishedImages?.customBarImage?.url, "https://cdn.shopify.com/bar.png");
  assert.equal(originalImages?.featuredImage?.url, "https://cdn.shopify.com/feature.png");
  assert.equal(await repository.readBundleOffer(shopB, created.offerId, prisma), null);
  await prisma.$executeRawUnsafe(
    `UPDATE "BundleOffer" SET "storefrontActive" = true, "codFormActive" = true WHERE "id" = $1::uuid`,
    created.offerId,
  );
  await assert.rejects(prisma.$executeRawUnsafe(
    `UPDATE "BundleOffer" SET "status" = 'DRAFT' WHERE "id" = $1::uuid`,
    created.offerId,
  ));

  const duplicate = await repository.duplicateBundleOffer(shopA, created.offerId, prisma);
  assertOk(duplicate);
  const copy = await repository.readBundleOffer(shopA, duplicate.offerId, prisma);
  assert.equal(copy?.status, "DRAFT");
  assert.equal(copy?.publishedRevisionId, null);
  assert.equal(copy?.storefrontActive, false);
  assert.equal((await repository.duplicateBundleOffer(shopB, created.offerId, prisma)).code, "not_found");

  const deactivated = await repository.deactivateBundleOffer(shopA, created.offerId, prisma);
  assert.equal(deactivated.status, "INACTIVE");
  const inactive = await repository.readBundleOffer(shopA, created.offerId, prisma);
  assert.equal(inactive?.storefrontActive, false);
  assert.equal(inactive?.codFormActive, false);
  assert.equal((await repository.deactivateBundleOffer(shopB, created.offerId, prisma)).code, "not_found");

  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "BundleRevision" SET "schemaVersion" = 1 WHERE "id" = $1::uuid`, publishable.revisionId));

  const otherOffer = await repository.createBundleOffer(shopA, emptyOffer("Other"), prisma);
  assertOk(otherOffer);
  await assert.rejects(prisma.$executeRawUnsafe(
    `UPDATE "BundleOffer" SET "publishedRevisionId" = $1::uuid WHERE "id" = $2::uuid`,
    publishable.revisionId,
    otherOffer.offerId,
  ));
  await assert.rejects(prisma.$executeRawUnsafe(
    `UPDATE "BundleOffer" SET "draftRevisionId" = $1::uuid WHERE "id" = $2::uuid`,
    publishable.revisionId,
    otherOffer.offerId,
  ));

  await assert.rejects(prisma.$executeRawUnsafe(
    `UPDATE "BundleOffer" SET "status" = 'PUBLISHED', "storefrontActive" = true, "publishedRevisionId" = NULL WHERE "id" = $1::uuid`,
    created.offerId,
  ));

  assert.equal((await repository.deleteBundleOffer(shopB, duplicate.offerId, prisma)).code, "not_found");
  assert.equal((await repository.deleteBundleOffer(shopA, duplicate.offerId, prisma)).ok, true);
  assert.equal(await prisma.bundleRevision.count({ where: { offerId: duplicate.offerId } }), 0);
  assert.equal((await repository.deleteBundleOffer(shopA, created.offerId, prisma)).ok, true);
  assert.equal((await repository.deleteBundleOffer(shopA, otherOffer.offerId, prisma)).ok, true);

  const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN ('Session', 'Shop', 'LoginHistory', 'BundleOffer', 'BundleRevision')
     ORDER BY table_name`,
  );
  assert.deepEqual(tables.map((table) => table.table_name), [
    "BundleOffer",
    "BundleRevision",
    "LoginHistory",
    "Session",
    "Shop",
  ]);
  const migrations = await prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: Date | null }>>(
    `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY migration_name`,
  );
  assert.deepEqual(migrations.map((migration) => migration.migration_name), [
    "20261124000000_create_session_table",
    "20261125022000_add_shop_and_login_history",
    "20261127100000_add_bundle_offers",
  ]);
  assert.equal(migrations.every((migration) => migration.finished_at != null), true);

  const offersBeforeRollback = await prisma.bundleOffer.count({ where: { shopId: shopA } });
  await assert.rejects(prisma.$transaction(async (tx) => {
    const offer = await tx.bundleOffer.create({
      data: { shopId: shopA, name: "Rollback", status: "DRAFT" },
    });
    await tx.bundleRevision.create({
      data: {
        offerId: offer.id,
        shopId: shopB,
        schemaVersion: 1,
        document: { invalid: true },
      },
    });
  }));
  assert.equal(await prisma.bundleOffer.count({ where: { shopId: shopA } }), offersBeforeRollback);

  const shopC = crypto.randomUUID();
  createdShops.push(shopC);
  await prisma.shop.create({
    data: {
      id: shopC,
      shopifyShopId: `test-${shopC}`,
      shopDomain: `${shopC}.example.com`,
      shopName: "Bundle cascade",
      currency: "USD",
      timezone: "UTC",
    },
  });
  const cascaded = await repository.createBundleOffer(shopC, emptyOffer("Cascade"), prisma);
  assertOk(cascaded);
  assert.equal(await prisma.bundleRevision.count({ where: { offerId: cascaded.offerId } }) > 0, true);
  await prisma.shop.delete({ where: { id: shopC } });
  assert.equal(await prisma.bundleOffer.count({ where: { id: cascaded.offerId } }), 0);
  assert.equal(await prisma.bundleRevision.count({ where: { offerId: cascaded.offerId } }), 0);

  const probe = await repository.createBundleOffer(shopA, emptyOffer("Probe"), prisma);
  assertOk(probe);
  const security = await prisma.$queryRawUnsafe<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
    `SELECT relname, relrowsecurity, relforcerowsecurity
     FROM pg_class
     WHERE relname IN ('BundleOffer', 'BundleRevision')
     ORDER BY relname`,
  );
  assert.equal(security.length, 2);
  assert.equal(security.every((table) => table.relrowsecurity === true), true);
  assert.equal(security.every((table) => table.relforcerowsecurity === false), true);

  const grants = await prisma.$queryRawUnsafe<Array<{ grantee: string }>>(
    `SELECT grantee FROM information_schema.role_table_grants
     WHERE grantee IN ('anon', 'authenticated')
       AND table_schema = 'public'
       AND table_name IN ('BundleOffer', 'BundleRevision', 'Shop', 'LoginHistory', 'Session')`,
  );
  assert.equal(grants.length, 0);
  const functionPrivileges = await prisma.$queryRawUnsafe<Array<{ anon_execute: boolean; authenticated_execute: boolean }>>(
    `SELECT has_function_privilege('anon', '"reject_bundle_revision_update"()', 'EXECUTE') AS anon_execute,
            has_function_privilege('authenticated', '"bundle_offer_pointers_match"()', 'EXECUTE') AS authenticated_execute`,
  );
  assert.equal(functionPrivileges[0]?.anon_execute, false);
  assert.equal(functionPrivileges[0]?.authenticated_execute, false);
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
    await tx.$queryRawUnsafe(`SELECT 1 FROM "BundleOffer"`);
  }));
  await assert.rejects(prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE authenticated`);
    await tx.$queryRawUnsafe(`SELECT 1 FROM "BundleRevision"`);
  }));

  await prisma.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO cod_form_rls_probe`);
  await prisma.$executeRawUnsafe(`GRANT SELECT ON TABLE "BundleOffer", "BundleRevision" TO cod_form_rls_probe`);
  const visibleToOwner = await prisma.bundleOffer.count();
  assert.equal(visibleToOwner > 0, true);
  const hidden = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE cod_form_rls_probe`);
    return tx.$queryRawUnsafe<Array<{ count: number }>>(`SELECT count(*)::int AS count FROM "BundleOffer"`);
  });
  assert.equal(Number(hidden[0]?.count), 0);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON TABLE "BundleOffer", "BundleRevision" FROM cod_form_rls_probe`);
  await prisma.$executeRawUnsafe(`REVOKE USAGE ON SCHEMA public FROM cod_form_rls_probe`);

  console.log(JSON.stringify({
    ok: true,
    database: "tested",
    checks: [
      "migrations",
      "tables",
      "create",
      "read",
      "list",
      "save_draft",
      "publish",
      "publish_does_not_activate",
      "duplicate",
      "deactivate",
      "revision_immutable",
      "pointer_ownership",
      "cross_merchant",
      "concurrent_edit",
      "transaction_rollback",
      "cascade_delete",
      "rls",
      "revoked_roles",
      "activation_requires_published_revision",
    ],
  }));
} finally {
  await prisma.bundleOffer.deleteMany({ where: { shopId: { in: createdShops } } });
  await prisma.shop.deleteMany({ where: { id: { in: createdShops } } });
  await prisma.$disconnect();
  await vite.close();
}
