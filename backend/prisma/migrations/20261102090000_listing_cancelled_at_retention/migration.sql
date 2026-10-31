-- PII retention (M9) measures "ended" from closed_at / cancelled_at. Cancellations did not write cancelled_at before;
-- take it from the cancellation record, or the last change of a listing cancelled without one.
UPDATE "listing" l SET cancelled_at = COALESCE(
  (SELECT c.created_at FROM "listing_cancellation" c WHERE c.listing_id = l.id), l.updated_at)
WHERE l.status = 'CANCELLED' AND l.cancelled_at IS NULL;

-- The retention job's candidates: orders not yet anonymized, per listing (raw SQL, not in schema.prisma).
CREATE INDEX "order_listing_id_not_anonymized_idx" ON "order" ("listing_id") WHERE "anonymized_at" IS NULL;
