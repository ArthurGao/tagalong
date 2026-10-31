-- Anonymisation (M8b) erases a buyer's emails from the outbox by address, case-insensitively (raw SQL, not in schema.prisma).
CREATE INDEX "notification_outbox_recipient_lower_idx" ON "notification_outbox" (lower("recipient"));

-- The admin audit log (M8b) pages newest first without a filter.
-- CreateIndex
CREATE INDEX "audit_log_created_at_id_idx" ON "audit_log"("created_at", "id");
