-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MERCHANT', 'ADMIN');

-- CreateEnum
CREATE TYPE "AuditActorRole" AS ENUM ('MERCHANT', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MerchantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('RETAIL', 'SESSION', 'EVENT');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('PICKUP', 'ONSITE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Pricing" AS ENUM ('FREE', 'PAID');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CancellationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_FAILURES');

-- CreateEnum
CREATE TYPE "RefundTaskStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MERCHANT',
    "clerk_user_id" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant" (
    "id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "logo_url" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "gst_number" TEXT,
    "stripe_account_id" TEXT,
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "details_submitted" BOOLEAN NOT NULL DEFAULT false,
    "status" "MerchantStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspended_reason" TEXT,
    "suspended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_note" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing" (
    "id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "short_code" CHAR(8) NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" TEXT[],
    "type" "ListingType" NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "pricing" "Pricing" NOT NULL,
    "opens_at" TIMESTAMP(3),
    "closes_at" TIMESTAMP(3),
    "max_qty_per_order" INTEGER NOT NULL,
    "total_capacity" INTEGER,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "paid_seq" INTEGER NOT NULL DEFAULT 0,
    "indexable" BOOLEAN NOT NULL DEFAULT false,
    "show_participants" BOOLEAN NOT NULL DEFAULT true,
    "form_fields" JSONB NOT NULL DEFAULT '[]',
    "one_per_email" BOOLEAN NOT NULL,
    "allow_self_cancel" BOOLEAN NOT NULL,
    "self_cancel_until" TIMESTAMP(3),
    "remind_before_hours" INTEGER,
    "policy_text" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "taken_down_reason" TEXT,
    "taken_down_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_option" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "capacity" INTEGER,
    "sold_count" INTEGER NOT NULL DEFAULT 0,
    "reserved_count" INTEGER NOT NULL DEFAULT 0,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "location" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_option_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_point" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "window_start" TIMESTAMP(3),
    "window_end" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickup_point_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order" (
    "id" UUID NOT NULL,
    "public_code" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "listing_id" UUID NOT NULL,
    "merchant_id" UUID NOT NULL,
    "pickup_point_id" UUID,
    "buyer_name" TEXT NOT NULL,
    "buyer_email" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_note" TEXT,
    "display_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "form_answers" JSONB NOT NULL DEFAULT '{}',
    "is_free" BOOLEAN NOT NULL,
    "one_per_email" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "status" "OrderStatus" NOT NULL,
    "subtotal_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL,
    "total_cents" INTEGER NOT NULL,
    "refunded_cents" INTEGER NOT NULL DEFAULT 0,
    "sequence_no" INTEGER,
    "stripe_checkout_session_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "reservation_expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "attendee_name" TEXT,
    "attendee_answers" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "reason" TEXT,
    "stripe_refund_id" TEXT NOT NULL,
    "status" "RefundStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_cancellation" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "initiated_by_user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "refund_all" BOOLEAN NOT NULL,
    "status" "CancellationStatus" NOT NULL DEFAULT 'PENDING',
    "total_orders" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listing_cancellation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_task" (
    "id" UUID NOT NULL,
    "cancellation_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "RefundTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "stripe_refund_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refund_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "sent_at" TIMESTAMP(3),
    "dedupe_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stripe_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "AuditActorRole" NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_clerk_user_id_key" ON "user"("clerk_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_owner_user_id_key" ON "merchant"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_slug_key" ON "merchant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_stripe_account_id_key" ON "merchant"("stripe_account_id");

-- CreateIndex
CREATE INDEX "merchant_note_merchant_id_created_at_idx" ON "merchant_note"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "listing_short_code_key" ON "listing"("short_code");

-- CreateIndex
CREATE INDEX "listing_merchant_id_idx" ON "listing"("merchant_id");

-- CreateIndex
CREATE INDEX "listing_status_closes_at_idx" ON "listing"("status", "closes_at");

-- CreateIndex
CREATE INDEX "listing_option_listing_id_sort_order_idx" ON "listing_option"("listing_id", "sort_order");

-- CreateIndex
CREATE INDEX "pickup_point_listing_id_idx" ON "pickup_point"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_public_code_key" ON "order"("public_code");

-- CreateIndex
CREATE UNIQUE INDEX "order_idempotency_key_key" ON "order"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "order_stripe_checkout_session_id_key" ON "order"("stripe_checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_stripe_payment_intent_id_key" ON "order"("stripe_payment_intent_id");

-- CreateIndex
CREATE INDEX "order_listing_id_status_idx" ON "order"("listing_id", "status");

-- CreateIndex
CREATE INDEX "order_status_reservation_expires_at_idx" ON "order"("status", "reservation_expires_at");

-- CreateIndex
CREATE INDEX "order_buyer_email_idx" ON "order"("buyer_email");

-- CreateIndex
CREATE UNIQUE INDEX "order_listing_id_sequence_no_key" ON "order"("listing_id", "sequence_no");

-- CreateIndex
CREATE INDEX "order_item_order_id_idx" ON "order_item"("order_id");

-- CreateIndex
CREATE INDEX "order_item_option_id_idx" ON "order_item"("option_id");

-- CreateIndex
CREATE UNIQUE INDEX "refund_stripe_refund_id_key" ON "refund"("stripe_refund_id");

-- CreateIndex
CREATE INDEX "refund_order_id_idx" ON "refund"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_cancellation_listing_id_key" ON "listing_cancellation"("listing_id");

-- CreateIndex
CREATE INDEX "refund_task_status_next_attempt_at_idx" ON "refund_task"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "refund_task_cancellation_id_order_id_key" ON "refund_task"("cancellation_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_key" ON "notification_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_actor_user_id_created_at_idx" ON "audit_log"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_log_action_created_at_idx" ON "audit_log"("action", "created_at");

-- AddForeignKey
ALTER TABLE "merchant" ADD CONSTRAINT "merchant_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_note" ADD CONSTRAINT "merchant_note_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_note" ADD CONSTRAINT "merchant_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing" ADD CONSTRAINT "listing_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_option" ADD CONSTRAINT "listing_option_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_point" ADD CONSTRAINT "pickup_point_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order" ADD CONSTRAINT "order_pickup_point_id_fkey" FOREIGN KEY ("pickup_point_id") REFERENCES "pickup_point"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "listing_option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund" ADD CONSTRAINT "refund_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_cancellation" ADD CONSTRAINT "listing_cancellation_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_cancellation" ADD CONSTRAINT "listing_cancellation_initiated_by_user_id_fkey" FOREIGN KEY ("initiated_by_user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_task" ADD CONSTRAINT "refund_task_cancellation_id_fkey" FOREIGN KEY ("cancellation_id") REFERENCES "listing_cancellation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_task" ADD CONSTRAINT "refund_task_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints Prisma cannot express (backend/CLAUDE.md "Prisma conventions").

-- onePerEmail listings: one live registration per email, case-insensitive (DESIGN §7.6).
-- "one_per_email" is the order's snapshot of the listing flag; an index predicate cannot read listing.
CREATE UNIQUE INDEX "order_one_per_email_live_key"
  ON "order" ("listing_id", lower("buyer_email"))
  WHERE "one_per_email" AND "status" IN ('CONFIRMED', 'FULFILLED');

-- At most one unpaid order per email per listing (DESIGN §7.2): a resubmit expires the old one first.
CREATE UNIQUE INDEX "order_one_pending_per_email_key"
  ON "order" ("listing_id", lower("buyer_email"))
  WHERE "status" = 'PENDING_PAYMENT';

-- Never oversell (DESIGN §7): counters stay within capacity even if application code is wrong.
ALTER TABLE "listing_option"
  ADD CONSTRAINT "listing_option_counts_non_negative" CHECK ("sold_count" >= 0 AND "reserved_count" >= 0),
  ADD CONSTRAINT "listing_option_within_capacity"
    CHECK ("capacity" IS NULL OR "sold_count" + "reserved_count" <= "capacity"),
  ADD CONSTRAINT "listing_option_price_non_negative" CHECK ("price_cents" >= 0);

ALTER TABLE "listing"
  ADD CONSTRAINT "listing_counts_non_negative" CHECK ("sold_count" >= 0 AND "reserved_count" >= 0),
  ADD CONSTRAINT "listing_within_total_capacity"
    CHECK ("total_capacity" IS NULL OR "sold_count" + "reserved_count" <= "total_capacity"),
  ADD CONSTRAINT "listing_max_qty_positive" CHECK ("max_qty_per_order" >= 1);

ALTER TABLE "order"
  ADD CONSTRAINT "order_refunded_within_total" CHECK ("refunded_cents" >= 0 AND "refunded_cents" <= "total_cents");

ALTER TABLE "order_item"
  ADD CONSTRAINT "order_item_quantity_positive" CHECK ("quantity" >= 1);

-- AuditLog is append-only (DESIGN §5.1). TRUNCATE (test resets) does not fire row triggers.
CREATE FUNCTION "audit_log_reject_change"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION "audit_log_reject_change"();

-- One ADMIN_SIGN_IN audit row per Clerk session: makes webhook redelivery a no-op (ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "audit_log_admin_sign_in_session_key"
  ON "audit_log" ("target_id")
  WHERE "action" = 'ADMIN_SIGN_IN';
