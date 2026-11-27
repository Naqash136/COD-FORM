-- Additive bundle configuration. Does not alter Session, Shop, or LoginHistory.

-- CreateEnum
CREATE TYPE "BundleOfferStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'INACTIVE');

-- CreateTable
CREATE TABLE "BundleOffer" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "BundleOfferStatus" NOT NULL DEFAULT 'DRAFT',
    "storefrontActive" BOOLEAN NOT NULL DEFAULT false,
    "codFormActive" BOOLEAN NOT NULL DEFAULT false,
    "draftRevisionId" UUID,
    "publishedRevisionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BundleOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BundleRevision" (
    "id" UUID NOT NULL,
    "offerId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "schemaVersion" INTEGER NOT NULL,
    "document" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BundleRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BundleOffer_draftRevisionId_key" ON "BundleOffer"("draftRevisionId");

-- CreateIndex
CREATE UNIQUE INDEX "BundleOffer_publishedRevisionId_key" ON "BundleOffer"("publishedRevisionId");

-- CreateIndex
CREATE INDEX "BundleOffer_shopId_status_idx" ON "BundleOffer"("shopId", "status");

-- CreateIndex
CREATE INDEX "BundleOffer_shopId_updatedAt_idx" ON "BundleOffer"("shopId", "updatedAt");

-- CreateIndex
CREATE INDEX "BundleRevision_offerId_createdAt_idx" ON "BundleRevision"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "BundleRevision_shopId_idx" ON "BundleRevision"("shopId");

-- AddForeignKey
ALTER TABLE "BundleOffer" ADD CONSTRAINT "BundleOffer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleRevision" ADD CONSTRAINT "BundleRevision_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "BundleOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleOffer" ADD CONSTRAINT "BundleOffer_draftRevisionId_fkey" FOREIGN KEY ("draftRevisionId") REFERENCES "BundleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BundleOffer" ADD CONSTRAINT "BundleOffer_publishedRevisionId_fkey" FOREIGN KEY ("publishedRevisionId") REFERENCES "BundleRevision"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BundleRevision" ADD CONSTRAINT "BundleRevision_schemaVersion_positive" CHECK ("schemaVersion" > 0);

-- Storefront and COD Form activation are not part of publishing a revision.
ALTER TABLE "BundleOffer" ADD CONSTRAINT "BundleOffer_activation_requires_publish" CHECK (
    ("storefrontActive" = false AND "codFormActive" = false)
    OR ("status" = 'PUBLISHED' AND "publishedRevisionId" IS NOT NULL)
);

CREATE OR REPLACE FUNCTION "reject_bundle_revision_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'BundleRevision rows are immutable';
END;
$$;

CREATE TRIGGER "BundleRevision_immutable"
BEFORE UPDATE ON "BundleRevision"
FOR EACH ROW
EXECUTE FUNCTION "reject_bundle_revision_update"();

CREATE OR REPLACE FUNCTION "bundle_revision_shop_matches_offer"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  offer_shop uuid;
BEGIN
  SELECT "shopId" INTO offer_shop FROM "BundleOffer" WHERE "id" = NEW."offerId";
  IF offer_shop IS NULL OR offer_shop <> NEW."shopId" THEN
    RAISE EXCEPTION 'BundleRevision shop does not match its offer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BundleRevision_shop_matches_offer"
BEFORE INSERT ON "BundleRevision"
FOR EACH ROW
EXECUTE FUNCTION "bundle_revision_shop_matches_offer"();

CREATE OR REPLACE FUNCTION "bundle_offer_pointers_match"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_offer uuid;
  revision_shop uuid;
BEGIN
  IF NEW."draftRevisionId" IS NOT NULL THEN
    SELECT "offerId", "shopId" INTO revision_offer, revision_shop
    FROM "BundleRevision" WHERE "id" = NEW."draftRevisionId";
    IF revision_offer IS NULL OR revision_offer <> NEW."id" OR revision_shop <> NEW."shopId" THEN
      RAISE EXCEPTION 'BundleOffer draft revision does not belong to this offer';
    END IF;
  END IF;
  IF NEW."publishedRevisionId" IS NOT NULL THEN
    SELECT "offerId", "shopId" INTO revision_offer, revision_shop
    FROM "BundleRevision" WHERE "id" = NEW."publishedRevisionId";
    IF revision_offer IS NULL OR revision_offer <> NEW."id" OR revision_shop <> NEW."shopId" THEN
      RAISE EXCEPTION 'BundleOffer published revision does not belong to this offer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "BundleOffer_pointers_match"
BEFORE INSERT OR UPDATE ON "BundleOffer"
FOR EACH ROW
EXECUTE FUNCTION "bundle_offer_pointers_match"();

REVOKE ALL ON FUNCTION "reject_bundle_revision_update"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "bundle_revision_shop_matches_offer"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "bundle_offer_pointers_match"() FROM PUBLIC;

-- The postgres role used by Prisma bypasses RLS. These policies deny the
-- Supabase Data API roles. Application isolation is enforced in server code
-- from the verified Shopify session.
ALTER TABLE "BundleOffer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BundleRevision" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "BundleOffer" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "BundleRevision" FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION "reject_bundle_revision_update"() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION "bundle_revision_shop_matches_offer"() FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION "bundle_offer_pointers_match"() FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "BundleOffer" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "BundleRevision" FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION "reject_bundle_revision_update"() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION "bundle_revision_shop_matches_offer"() FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION "bundle_offer_pointers_match"() FROM authenticated';
  END IF;
END $$;
