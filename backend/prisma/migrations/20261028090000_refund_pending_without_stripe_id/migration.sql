-- A refund is recorded (PENDING) when it is decided, before Stripe is called; Stripe's id arrives with its answer.
ALTER TABLE "refund" ALTER COLUMN "stripe_refund_id" DROP NOT NULL;
