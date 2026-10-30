-- Admin console (M8a): risk flags sum a merchant's paid orders over time; the overview sums platform GMV.
CREATE INDEX "order_merchant_id_paid_at_idx" ON "order"("merchant_id", "paid_at");
CREATE INDEX "order_paid_at_idx" ON "order"("paid_at");
