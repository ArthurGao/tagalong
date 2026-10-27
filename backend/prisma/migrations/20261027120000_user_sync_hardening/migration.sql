-- Codex review of M1: Clerk user sync hardening.

-- A deleted account keeps its email for history, so uniqueness applies to live users only;
-- otherwise the same address can never sign up again.
DROP INDEX "user_email_key";
CREATE INDEX "user_email_idx" ON "user"("email");
CREATE UNIQUE INDEX "user_email_live_key" ON "user"("email") WHERE "deleted_at" IS NULL;

-- Clerk's updated_at of the last applied user.* webhook, so a late, older event cannot overwrite it.
ALTER TABLE "user" ADD COLUMN "clerk_updated_at" TIMESTAMP(3);
