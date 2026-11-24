-- CreateEnum
CREATE TYPE "ShopStatus" AS ENUM ('ACTIVE', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "LoginEventType" AS ENUM ('INSTALL', 'REINSTALL', 'LOGIN', 'APP_ACCESS', 'UNINSTALL');

-- CreateTable
CREATE TABLE "Shop" (
    "id" UUID NOT NULL,
    "shopifyShopId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "email" TEXT,
    "ownerName" TEXT,
    "phone" TEXT,
    "countryCode" TEXT,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "shopifyPlan" TEXT,
    "status" "ShopStatus" NOT NULL DEFAULT 'ACTIVE',
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInstalledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginHistory" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "shopifyUserId" TEXT,
    "eventType" "LoginEventType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopifyShopId_key" ON "Shop"("shopifyShopId");

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopDomain_key" ON "Shop"("shopDomain");

-- CreateIndex
CREATE INDEX "Shop_status_idx" ON "Shop"("status");

-- CreateIndex
CREATE INDEX "LoginHistory_shopId_createdAt_idx" ON "LoginHistory"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginHistory_shopId_shopifyUserId_createdAt_idx" ON "LoginHistory"("shopId", "shopifyUserId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginHistory_createdAt_idx" ON "LoginHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "LoginHistory" ADD CONSTRAINT "LoginHistory_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The postgres role used by Prisma bypasses RLS. These policies deny the
-- Supabase Data API roles. Application isolation is enforced in server code
-- from the verified Shopify session.
ALTER TABLE "Shop" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LoginHistory" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE "Shop" FROM anon';
    EXECUTE 'REVOKE ALL ON TABLE "LoginHistory" FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON TABLE "Shop" FROM authenticated';
    EXECUTE 'REVOKE ALL ON TABLE "LoginHistory" FROM authenticated';
  END IF;
END $$;
