-- Find-my-orders requests are queued and handled by recovery.job, so every request does the same work (DESIGN §9).
CREATE TABLE "order_recovery_request" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_recovery_request_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "order_recovery_request_created_at_idx" ON "order_recovery_request"("created_at");

-- A session never ends before it starts (DESIGN §5), whichever code writes it; calendars would show it upside down.
-- Ends saved before this rule are dropped, so those sessions fall back to the calendar's default length.
UPDATE "listing_option" SET "ends_at" = NULL WHERE "ends_at" <= "starts_at";
ALTER TABLE "listing_option"
  ADD CONSTRAINT "listing_option_ends_after_start" CHECK ("ends_at" IS NULL OR "starts_at" IS NULL OR "ends_at" > "starts_at");
