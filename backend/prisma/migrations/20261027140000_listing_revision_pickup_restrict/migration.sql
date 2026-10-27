-- Codex review of M3.

-- Optimistic concurrency for listing edits: stale editors get LISTING_STALE instead of overwriting.
ALTER TABLE "listing" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

-- A pickup point used by an order can never be deleted, even if an order takes it mid-edit (DESIGN §5b).
ALTER TABLE "order" DROP CONSTRAINT "order_pickup_point_id_fkey";
ALTER TABLE "order" ADD CONSTRAINT "order_pickup_point_id_fkey"
  FOREIGN KEY ("pickup_point_id") REFERENCES "pickup_point"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
