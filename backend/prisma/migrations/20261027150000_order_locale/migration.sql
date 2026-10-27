-- Buyer's UI language at checkout, so emails sent later by the outbox use it (DESIGN §5.1, §12).
ALTER TABLE "order" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'zh-CN';
