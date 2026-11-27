import type { BundleDocument } from "./schema";

export type OfferPointers = {
  id: string;
  shopId: string;
  name: string;
  status: "DRAFT" | "PUBLISHED" | "INACTIVE";
  draftRevisionId: string | null;
  publishedRevisionId: string | null;
  storefrontActive: boolean;
  codFormActive: boolean;
};

export type RevisionInsert = {
  id: string;
  offerId: string;
  shopId: string;
  schemaVersion: 1;
  document: BundleDocument;
};

export type SaveDraftPlan = {
  insertRevision: RevisionInsert;
  offerUpdate: {
    name: string;
    draftRevisionId: string;
  };
};

export type PublishPlan = {
  offerUpdate: {
    publishedRevisionId: string;
    status: "PUBLISHED";
  };
};

export type PlanError = { ok: false; code: "not_found" | "revision_reused" };

export function planSaveDraft(
  offer: OfferPointers,
  document: BundleDocument,
  revisionId: string,
): SaveDraftPlan | PlanError {
  if (revisionId === offer.publishedRevisionId || revisionId === offer.draftRevisionId) {
    return { ok: false, code: "revision_reused" };
  }
  return {
    insertRevision: {
      id: revisionId,
      offerId: offer.id,
      shopId: offer.shopId,
      schemaVersion: document.schemaVersion,
      document,
    },
    offerUpdate: {
      name: document.name,
      draftRevisionId: revisionId,
    },
  };
}

export type DeactivatePlan = {
  status: "INACTIVE";
  storefrontActive: false;
  codFormActive: false;
};

export type DuplicatePlan = {
  offer: {
    id: string;
    shopId: string;
    name: string;
    status: "DRAFT";
    storefrontActive: false;
    codFormActive: false;
    publishedRevisionId: null;
  };
  insertRevision: RevisionInsert;
};

export function saveDraftGuard(offer: OfferPointers, expectedDraftRevisionId: string | null) {
  return {
    id: offer.id,
    shopId: offer.shopId,
    draftRevisionId: expectedDraftRevisionId,
    publishedRevisionId: offer.publishedRevisionId,
    storefrontActive: offer.storefrontActive,
    codFormActive: offer.codFormActive,
  };
}

export function planDeactivate(): DeactivatePlan {
  return {
    status: "INACTIVE",
    storefrontActive: false,
    codFormActive: false,
  };
}

export function planDuplicate(
  offer: OfferPointers,
  source: BundleDocument | null,
  offerId: string,
  revisionId: string,
): DuplicatePlan | PlanError {
  if (!source) return { ok: false, code: "not_found" };
  const name = `Copy of ${source.name}`.trim().slice(0, 120).trim();
  const document = { ...source, name };
  return {
    offer: {
      id: offerId,
      shopId: offer.shopId,
      name,
      status: "DRAFT",
      storefrontActive: false,
      codFormActive: false,
      publishedRevisionId: null,
    },
    insertRevision: {
      id: revisionId,
      offerId,
      shopId: offer.shopId,
      schemaVersion: document.schemaVersion,
      document,
    },
  };
}

export function planPublish(
  offer: OfferPointers,
  revision: { id: string; offerId: string; shopId: string },
): PublishPlan | PlanError {
  if (revision.shopId !== offer.shopId || revision.offerId !== offer.id) {
    return { ok: false, code: "not_found" };
  }
  return {
    offerUpdate: {
      publishedRevisionId: revision.id,
      status: "PUBLISHED",
    },
  };
}
