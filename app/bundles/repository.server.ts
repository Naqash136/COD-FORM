import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import type { BundleDocument } from "./schema";
import { validateDocument } from "./validate";
import {
  planDeactivate,
  planDuplicate,
  planPublish,
  planSaveDraft,
  saveDraftGuard,
  type OfferPointers,
} from "./revisions";

const transactionOptions = { maxWait: 15_000, timeout: 30_000 };

type Db = PrismaClient;
type OfferDelegate = {
  id: string;
  shopId: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  storefrontActive: boolean;
  codFormActive: boolean;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  draftRevision: { id: string; document: Prisma.JsonValue } | null;
  publishedRevision: { id: string; document: Prisma.JsonValue } | null;
};

export type BundleWriteResult =
  | { ok: true; offerId: string; revisionId: string | null; status: "DRAFT" | "PUBLISHED" | "INACTIVE" }
  | { ok: false; code: "invalid" | "not_found" | "conflict"; errors?: { path: string; code: string; message: string }[] };

export type StoredDocument =
  | { revisionId: string; valid: true; document: BundleDocument }
  | { revisionId: string; valid: false };

export type BundleOfferView = {
  id: string;
  shopId: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  storefrontActive: boolean;
  codFormActive: boolean;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  draft: StoredDocument | null;
  published: StoredDocument | null;
};

export type BundleOfferSummary = {
  id: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  storefrontActive: boolean;
  codFormActive: boolean;
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  updatedAt: Date;
};

async function resolveClient(client?: Db): Promise<Db> {
  if (client) return client;
  const module = await import("../db.server");
  return module.default;
}

export async function createBundleOffer(shopId: string, input: unknown, client?: Db): Promise<BundleWriteResult> {
  const validated = validateDocument(input, "draft");
  if (!validated.ok) return { ok: false, code: "invalid", errors: validated.errors };
  const db = await resolveClient(client);
  const revisionId = randomUUID();

  return db.$transaction(async (tx) => {
    const offer = await tx.bundleOffer.create({
      data: {
        shopId,
        name: validated.document.name,
        status: "DRAFT",
        storefrontActive: false,
        codFormActive: false,
      },
    });
    await tx.bundleRevision.create({
      data: {
        id: revisionId,
        offerId: offer.id,
        shopId,
        schemaVersion: validated.document.schemaVersion,
        document: toJson(validated.document),
      },
    });
    await tx.bundleOffer.update({
      where: { id: offer.id },
      data: { draftRevisionId: revisionId },
    });
    return { ok: true as const, offerId: offer.id, revisionId, status: "DRAFT" as const };
  }, transactionOptions);
}

export async function readBundleOffer(shopId: string, offerId: string, client?: Db): Promise<BundleOfferView | null> {
  const db = await resolveClient(client);
  const offer = await db.bundleOffer.findFirst({
    where: { id: offerId, shopId },
    include: { draftRevision: true, publishedRevision: true },
  });
  if (!offer) return null;
  return present(offer);
}

export async function listBundleOffers(shopId: string, client?: Db): Promise<BundleOfferSummary[]> {
  const db = await resolveClient(client);
  const offers = await db.bundleOffer.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
  });
  return offers.map((offer) => ({
    id: offer.id,
    name: offer.name,
    status: offer.status,
    storefrontActive: offer.storefrontActive,
    codFormActive: offer.codFormActive,
    draftRevisionId: offer.draftRevisionId,
    publishedRevisionId: offer.publishedRevisionId,
    updatedAt: offer.updatedAt,
  }));
}

export async function saveBundleDraft(
  shopId: string,
  offerId: string,
  input: unknown,
  expectedDraftRevisionId: string | null,
  client?: Db,
): Promise<BundleWriteResult> {
  const validated = validateDocument(input, "draft");
  if (!validated.ok) return { ok: false, code: "invalid", errors: validated.errors };
  const db = await resolveClient(client);

  return db.$transaction(async (tx) => {
    const offer = await tx.bundleOffer.findFirst({ where: { id: offerId, shopId } });
    if (!offer) return { ok: false as const, code: "not_found" as const };
    const revisionId = randomUUID();
    const plan = planSaveDraft(pointers(offer), validated.document, revisionId);
    if ("ok" in plan) return { ok: false as const, code: "conflict" as const };

    await tx.bundleRevision.create({
      data: {
        ...plan.insertRevision,
        document: toJson(plan.insertRevision.document),
      },
    });
    const updated = await tx.bundleOffer.updateMany({
      where: saveDraftGuard(pointers(offer), expectedDraftRevisionId),
      data: plan.offerUpdate,
    });
    if (updated.count !== 1) return { ok: false as const, code: "conflict" as const };
    return { ok: true as const, offerId: offer.id, revisionId, status: offer.status };
  }, transactionOptions);
}

export async function publishCurrentDocument(
  shopId: string,
  offerId: string,
  input: unknown,
  expectedDraftRevisionId: string | null,
  client?: Db,
): Promise<BundleWriteResult> {
  const validated = validateDocument(input, "publish");
  if (!validated.ok) return { ok: false, code: "invalid", errors: validated.errors };
  const db = await resolveClient(client);
  const revisionId = randomUUID();
  try {
    return await db.$transaction(async (tx) => {
      const offer = await tx.bundleOffer.findFirst({ where: { id: offerId, shopId } });
      if (!offer) return { ok: false as const, code: "not_found" as const };
      if (offer.draftRevisionId !== expectedDraftRevisionId) return { ok: false as const, code: "conflict" as const };
      await tx.bundleRevision.create({
        data: {
          id: revisionId,
          offerId: offer.id,
          shopId: offer.shopId,
          schemaVersion: validated.document.schemaVersion,
          document: toJson(validated.document),
        },
      });
      const updated = await tx.bundleOffer.updateMany({
        where: {
          id: offer.id,
          shopId: offer.shopId,
          draftRevisionId: expectedDraftRevisionId,
          publishedRevisionId: offer.publishedRevisionId,
          storefrontActive: offer.storefrontActive,
          codFormActive: offer.codFormActive,
        },
        data: {
          name: validated.document.name,
          draftRevisionId: revisionId,
          publishedRevisionId: revisionId,
          status: "PUBLISHED",
        },
      });
      if (updated.count !== 1) throw new Error("publish_conflict");
      return { ok: true as const, offerId: offer.id, revisionId, status: "PUBLISHED" as const };
    }, transactionOptions);
  } catch (error) {
    if (error instanceof Error && error.message === "publish_conflict") return { ok: false, code: "conflict" };
    throw error;
  }
}

export async function publishBundleRevision(
  shopId: string,
  offerId: string,
  revisionId: string,
  client?: Db,
): Promise<BundleWriteResult> {
  const db = await resolveClient(client);
  return db.$transaction(async (tx) => {
    const offer = await tx.bundleOffer.findFirst({ where: { id: offerId, shopId } });
    const revision = await tx.bundleRevision.findFirst({ where: { id: revisionId, offerId, shopId } });
    if (!offer || !revision) return { ok: false as const, code: "not_found" as const };

    const validated = validateDocument(revision.document, "publish");
    if (!validated.ok) return { ok: false as const, code: "invalid" as const, errors: validated.errors };

    const plan = planPublish(pointers(offer), revision);
    if ("ok" in plan) return { ok: false as const, code: "not_found" as const };

    const updated = await tx.bundleOffer.updateMany({
      where: {
        id: offer.id,
        shopId: offer.shopId,
        draftRevisionId: offer.draftRevisionId,
        publishedRevisionId: offer.publishedRevisionId,
        storefrontActive: offer.storefrontActive,
        codFormActive: offer.codFormActive,
      },
      data: plan.offerUpdate,
    });
    if (updated.count !== 1) return { ok: false as const, code: "conflict" as const };
    return { ok: true as const, offerId: offer.id, revisionId: revision.id, status: "PUBLISHED" as const };
  }, transactionOptions);
}

export async function duplicateBundleOffer(shopId: string, offerId: string, client?: Db): Promise<BundleWriteResult> {
  const db = await resolveClient(client);
  return db.$transaction(async (tx) => {
    const offer = await tx.bundleOffer.findFirst({
      where: { id: offerId, shopId },
      include: { draftRevision: true, publishedRevision: true },
    });
    if (!offer) return { ok: false as const, code: "not_found" as const };
    const source = offer.draftRevision?.document ?? offer.publishedRevision?.document ?? null;
    const validated = source == null ? null : validateDocument(source, "draft");
    if (!validated?.ok) return { ok: false as const, code: "invalid" as const, errors: validated?.errors };
    const newOfferId = randomUUID();
    const revisionId = randomUUID();
    const plan = planDuplicate(pointers(offer), validated.document, newOfferId, revisionId);
    if ("ok" in plan) return { ok: false as const, code: "not_found" as const };

    await tx.bundleOffer.create({ data: plan.offer });
    await tx.bundleRevision.create({
      data: {
        ...plan.insertRevision,
        document: toJson(plan.insertRevision.document),
      },
    });
    await tx.bundleOffer.update({
      where: { id: newOfferId },
      data: { draftRevisionId: revisionId },
    });
    return { ok: true as const, offerId: newOfferId, revisionId, status: "DRAFT" as const };
  }, transactionOptions);
}

export async function deactivateBundleOffer(shopId: string, offerId: string, client?: Db): Promise<BundleWriteResult> {
  const db = await resolveClient(client);
  const updated = await db.bundleOffer.updateMany({
    where: { id: offerId, shopId },
    data: planDeactivate(),
  });
  if (updated.count !== 1) return { ok: false, code: "not_found" };
  return { ok: true, offerId, revisionId: null, status: "INACTIVE" };
}

export async function deleteBundleOffer(shopId: string, offerId: string, client?: Db): Promise<BundleWriteResult> {
  const db = await resolveClient(client);
  const deleted = await db.bundleOffer.deleteMany({ where: { id: offerId, shopId } });
  if (deleted.count !== 1) return { ok: false, code: "not_found" };
  return { ok: true, offerId, revisionId: null, status: "DRAFT" };
}

function present(offer: OfferDelegate): BundleOfferView {
  return {
    id: offer.id,
    shopId: offer.shopId,
    name: offer.name,
    status: offer.status,
    storefrontActive: offer.storefrontActive,
    codFormActive: offer.codFormActive,
    draftRevisionId: offer.draftRevisionId,
    publishedRevisionId: offer.publishedRevisionId,
    createdAt: offer.createdAt,
    updatedAt: offer.updatedAt,
    draft: stored(offer.draftRevision),
    published: stored(offer.publishedRevision),
  };
}

function stored(revision: { id: string; document: Prisma.JsonValue } | null): StoredDocument | null {
  if (!revision) return null;
  const validated = validateDocument(revision.document, "draft");
  if (!validated.ok) return { revisionId: revision.id, valid: false };
  return { revisionId: revision.id, valid: true, document: validated.document };
}

function pointers(offer: OfferDelegate | {
  id: string;
  shopId: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  storefrontActive: boolean;
  codFormActive: boolean;
}): OfferPointers {
  return {
    id: offer.id,
    shopId: offer.shopId,
    name: offer.name,
    status: offer.status,
    draftRevisionId: offer.draftRevisionId,
    publishedRevisionId: offer.publishedRevisionId,
    storefrontActive: offer.storefrontActive,
    codFormActive: offer.codFormActive,
  };
}

function toJson(document: BundleDocument): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(document)) as Prisma.InputJsonValue;
}
