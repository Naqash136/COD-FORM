-- PostgreSQL baseline for the Shopify Session table.
-- Generated from prisma/schema.prisma with Prisma 6.19.3 (migrate diff).
-- Apply this to an empty PostgreSQL database only.
-- Do not apply prisma/migrations-sqlite. That SQL uses SQLite DATETIME and is not valid here.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- The Session table stores Shopify access tokens. Supabase exposes the public
-- schema through the Data API. RLS with no policies denies anon and authenticated.
-- Prisma connects as the postgres role, which bypasses RLS.
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
