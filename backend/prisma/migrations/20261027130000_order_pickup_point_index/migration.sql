-- Pickup point edits and deletions look up the orders that reference the point.
CREATE INDEX "order_pickup_point_id_idx" ON "order"("pickup_point_id");
