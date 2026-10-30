-- Admin lists (M8a) page newest first: merchants and listings by created_at, a merchant's listings by merchant and date.
-- DropIndex
DROP INDEX "listing_merchant_id_idx";

-- CreateIndex
CREATE INDEX "listing_merchant_id_created_at_idx" ON "listing"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "listing_created_at_id_idx" ON "listing"("created_at", "id");

-- CreateIndex
CREATE INDEX "merchant_created_at_id_idx" ON "merchant"("created_at", "id");

