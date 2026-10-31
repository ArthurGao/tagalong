-- Buyer anonymisation (M8b, DESIGN §9): when an order's PII was replaced.
-- AlterTable
ALTER TABLE "order" ADD COLUMN "anonymized_at" TIMESTAMP(3);

-- Admin order search and anonymisation look buyers up by email, case-insensitively (raw SQL, not in schema.prisma).
CREATE INDEX "order_buyer_email_lower_idx" ON "order" (lower("buyer_email"));

-- Admin order list (M8b) pages newest first.
-- CreateIndex
CREATE INDEX "order_created_at_id_idx" ON "order"("created_at", "id");
