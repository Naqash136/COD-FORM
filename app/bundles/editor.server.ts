import type { PrismaClient } from "@prisma/client";

import { createBundleOffer, listBundleOffers, publishCurrentDocument, readBundleOffer, saveBundleDraft, type BundleOfferView } from "./repository.server";
import { emptyDocument } from "./editor-state";
import type { BundleDocument } from "./schema";
import { verifyChangedImages, type ImageSelectionProduct } from "./images";
import { validateDocument } from "./validate";
import { isProductGid, isVariantGid } from "./shopify/ids";
import type { NormalizedProduct } from "./shopify/catalog";

type Db = PrismaClient;

async function resolveClient(client?: Db): Promise<Db> {
  if (client) return client;
  const module = await import("../db.server");
  return module.default;
}

async function shopIdForDomain(db: Db, shopDomain: string) {
  const shop = await db.shop.findUnique({ where: { shopDomain } });
  if (!shop || shop.status !== "ACTIVE") return null;
  return shop.id;
}

export async function createDraftForShop(shopDomain: string, client?: Db) {
  const db = await resolveClient(client);
  const shopId = await shopIdForDomain(db, shopDomain);
  if (!shopId) return { ok: false as const, code: "not_found" as const };
  return createBundleOffer(shopId, emptyDocument(), db);
}

export async function loadOfferForShop(shopDomain: string, offerId: string, client?: Db) {
  const db = await resolveClient(client);
  const shopId = await shopIdForDomain(db, shopDomain);
  if (!shopId) return null;
  return readBundleOffer(shopId, offerId, db);
}

export async function listOffersForShop(shopDomain: string, client?: Db) {
  const db = await resolveClient(client);
  const shopId = await shopIdForDomain(db, shopDomain);
  if (!shopId) return [];
  return listBundleOffers(shopId, db);
}

export function bundleStorageMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String(error.code) : "";
  const message = "message" in error ? String(error.message) : "";
  return code === "P2021" || /BundleOffer|does not exist/i.test(message);
}

export async function listOffersForView(shopDomain: string, client?: Db) {
  try {
    return { offers: await listOffersForShop(shopDomain, client), storageReady: true };
  } catch (error) {
    if (bundleStorageMissing(error)) return { offers: [], storageReady: false };
    throw error;
  }
}

export function verifyDocumentProducts(document: BundleDocument, products: NormalizedProduct[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  for (const productId of referencedProductIds(document)) {
    const product = byId.get(productId);
    if (!product) return { ok: false as const, message: "A selected product is no longer available in Shopify." };
    if (!product.variantsComplete) {
      return { ok: false as const, message: "Shopify did not return every variant, so the offer was not saved." };
    }
  }
  for (const variant of referencedVariants(document)) {
    const product = byId.get(variant.productId);
    if (!product) continue;
    const known = new Set(product.variants.map((item) => item.id));
    if (!variant.variantIds.every((id) => known.has(id))) {
      return { ok: false as const, message: "A selected variant does not belong to that Shopify product." };
    }
  }
  return { ok: true as const, document };
}

export async function saveDraftForShop(
  shopDomain: string,
  offerId: string,
  input: unknown,
  expectedDraftRevisionId: string | null,
  products: NormalizedProduct[],
  client?: Db,
  imageAccess?: { allowFixtureImages?: boolean; readableFileIds?: readonly string[] },
) {
  const validated = validateDocument(input, "draft");
  if (!validated.ok) return { ok: false as const, code: "invalid" as const, errors: validated.errors };
  const verified = verifyDocumentProducts(validated.document, products);
  if (!verified.ok) return { ok: false as const, code: "invalid" as const, message: verified.message };
  const db = await resolveClient(client);
  const shopId = await shopIdForDomain(db, shopDomain);
  if (!shopId) return { ok: false as const, code: "not_found" as const };
  const existing = await readBundleOffer(shopId, offerId, db);
  const previous = existing?.draft?.valid ? existing.draft.document : existing?.published?.valid ? existing.published.document : null;
  const images = verifyChangedImages(previous, verified.document, products as ImageSelectionProduct[], {
    allowFixtureImages: imageAccess?.allowFixtureImages === true,
    readableFileIds: imageAccess?.readableFileIds,
  });
  if (!images.ok) return { ok: false as const, code: "invalid" as const, message: images.message };
  return saveBundleDraft(shopId, offerId, verified.document, expectedDraftRevisionId, db);
}

export async function publishDraftForShop(
  shopDomain: string,
  offerId: string,
  input: unknown,
  expectedDraftRevisionId: string | null,
  products: NormalizedProduct[],
  client?: Db,
  imageAccess?: { allowFixtureImages?: boolean; readableFileIds?: readonly string[] },
) {
  const publishable = validateDocument(input, "publish");
  if (!publishable.ok) return { ok: false as const, code: "invalid" as const, errors: publishable.errors };
  const verified = verifyDocumentProducts(publishable.document, products);
  if (!verified.ok) return { ok: false as const, code: "invalid" as const, message: verified.message };
  const db = await resolveClient(client);
  const shopId = await shopIdForDomain(db, shopDomain);
  if (!shopId) return { ok: false as const, code: "not_found" as const };
  const existing = await readBundleOffer(shopId, offerId, db);
  const previous = existing?.draft?.valid ? existing.draft.document : existing?.published?.valid ? existing.published.document : null;
  const images = verifyChangedImages(previous, verified.document, products as ImageSelectionProduct[], {
    allowFixtureImages: imageAccess?.allowFixtureImages === true,
    readableFileIds: imageAccess?.readableFileIds,
  });
  if (!images.ok) return { ok: false as const, code: "invalid" as const, message: images.message };
  const published = await publishCurrentDocument(shopId, offerId, verified.document, expectedDraftRevisionId, db);
  if (!published.ok) return published;
  const offer = await readBundleOffer(shopId, offerId, db);
  return { ...published, storefrontActive: offer?.storefrontActive ?? false, codFormActive: offer?.codFormActive ?? false };
}

export function editableDocument(offer: BundleOfferView): BundleDocument | null {
  const stored = offer.draft ?? offer.published;
  if (!stored || !stored.valid) return null;
  return stored.document;
}

function referencedProductIds(document: BundleDocument) {
  const ids = new Set<string>();
  for (const item of document.products.items) ids.add(item.product.productId);
  for (const variant of referencedVariants(document)) ids.add(variant.productId);
  return [...ids].filter((id) => isProductGid(id));
}

function referencedVariants(document: BundleDocument) {
  const variants: Array<{ productId: string; variantIds: string[] }> = [];
  const add = (productId: string, variantIds: string[]) => {
    variants.push({ productId, variantIds: variantIds.filter((id) => isVariantGid(id)) });
  };
  for (const item of document.products.items) add(item.product.productId, [item.product.selectedVariantId, ...item.product.allowedVariantIds]);
  for (const bar of document.bars) {
    if (bar.type === "quantity_break" || bar.type === "alternative_product") add(bar.config.product.productId, [bar.config.product.selectedVariantId, ...bar.config.product.allowedVariantIds]);
    if (bar.type === "buy_x_get_y") {
      add(bar.config.product.productId, [bar.config.product.selectedVariantId, ...bar.config.product.allowedVariantIds]);
      if (bar.config.getProduct) add(bar.config.getProduct.productId, [bar.config.getProduct.selectedVariantId, ...bar.config.getProduct.allowedVariantIds]);
    }
    if (bar.type === "product_bundle") {
      for (const product of bar.config.products) add(product.product.productId, [product.product.selectedVariantId, ...product.product.allowedVariantIds]);
    }
    if (bar.type === "mix_and_match") {
      for (const slot of bar.config.slots) {
        add(slot.product.productId, [slot.product.selectedVariantId, ...slot.product.allowedVariantIds]);
        for (const swap of slot.swapProducts) add(swap.productId, [swap.selectedVariantId, ...swap.allowedVariantIds]);
      }
    }
  }
  return variants;
}
