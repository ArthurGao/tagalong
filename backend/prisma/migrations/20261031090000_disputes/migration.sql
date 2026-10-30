-- Stripe disputes on orders (DESIGN §8.3), kept in step by the charge.dispute.* webhooks for the admin console.
-- CreateTable
CREATE TABLE "dispute" (
    "id" TEXT NOT NULL,
    "order_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "open" BOOLEAN NOT NULL,
    "last_event_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dispute_merchant_id_open_idx" ON "dispute"("merchant_id", "open");

-- CreateIndex
CREATE INDEX "dispute_open_created_at_idx" ON "dispute"("open", "created_at");

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute" ADD CONSTRAINT "dispute_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

