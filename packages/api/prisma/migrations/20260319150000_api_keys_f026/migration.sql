-- CreateEnum
CREATE TYPE "api_key_tier" AS ENUM ('free', 'pro');

-- CreateTable
CREATE TABLE "api_keys" (
    "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
    "key_hash"     VARCHAR(64) NOT NULL,
    "key_prefix"   VARCHAR(8) NOT NULL,
    "name"         VARCHAR(255) NOT NULL,
    "tier"         "api_key_tier" NOT NULL DEFAULT 'free',
    "is_active"    BOOLEAN NOT NULL DEFAULT true,
    "expires_at"   TIMESTAMPTZ,
    "last_used_at" TIMESTAMPTZ,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_key_prefix_idx" ON "api_keys"("key_prefix");
