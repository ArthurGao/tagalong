-- The Checkout line name as sent to Stripe, fixed when the order is made: a recovered session replays the same request
-- under the same idempotency key even after the merchant renames the listing or option.
ALTER TABLE "order_item" ADD COLUMN "checkout_name" TEXT;
UPDATE "order_item" oi
SET checkout_name = l.title || ' · ' || lo.name
FROM "listing_option" lo, "order" o, "listing" l
WHERE lo.id = oi.option_id AND o.id = oi.order_id AND l.id = o.listing_id;
ALTER TABLE "order_item" ALTER COLUMN "checkout_name" SET NOT NULL;
