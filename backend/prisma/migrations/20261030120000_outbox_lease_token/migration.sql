-- outbox.job claims rows with a token; a worker whose lease has passed to another cannot write its result.
ALTER TABLE "notification_outbox" ADD COLUMN "lease_token" UUID;
