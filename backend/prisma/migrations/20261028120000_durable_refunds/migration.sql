-- Every platform refund (merchant, late payment, listing cancellation) now goes through refund_task.
ALTER TABLE "refund_task" ALTER COLUMN "cancellation_id" DROP NOT NULL;
ALTER TABLE "refund_task" ADD COLUMN "lease_token" UUID;
