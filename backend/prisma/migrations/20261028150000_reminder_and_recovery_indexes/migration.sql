-- reminder.job finds sessions starting soon; find-my-orders counts recent emails per address.
CREATE INDEX "listing_option_starts_at_idx" ON "listing_option"("starts_at");
CREATE INDEX "notification_outbox_recipient_type_created_at_idx" ON "notification_outbox"("recipient", "type", "created_at");
