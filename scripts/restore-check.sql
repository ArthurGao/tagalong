-- Restore drill check (docs/RUNBOOK.md §5). Run it against the restored branch and against production with the same
-- restore point, and diff the two outputs: they must be identical.
--   psql "$URL" -v t="'2026-11-01T03:00:00Z'" -f scripts/restore-check.sql
-- Only what cannot change after T is compared: rows created at or before T, by count and by a checksum over columns
-- that never change once written (ids, codes, amounts charged, the append-only audit log). Columns that later
-- refunds or status changes update (refunded_cents, status) are left out on purpose. Read-only.
\set ON_ERROR_STOP on
SELECT 'migrations at T' AS item, count(*)::text AS value FROM _prisma_migrations WHERE finished_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'merchants', count(*)::text || ' ' || coalesce(md5(string_agg(id::text || slug, ',' ORDER BY id)), 'none') FROM merchant WHERE created_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'listings', count(*)::text || ' ' || coalesce(md5(string_agg(id::text || short_code, ',' ORDER BY id)), 'none') FROM listing WHERE created_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'orders', count(*)::text || ' ' || coalesce(md5(string_agg(id::text || public_code || total_cents, ',' ORDER BY id)), 'none') FROM "order" WHERE created_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'order items', count(*)::text || ' ' || coalesce(md5(string_agg(i.order_id::text || i.option_id || i.quantity || i.unit_price_cents, ',' ORDER BY i.order_id, i.option_id)), 'none')
  FROM order_item i JOIN "order" o ON o.id = i.order_id WHERE o.created_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'audit rows', count(*)::text || ' ' || coalesce(md5(string_agg(id::text || action || target_id, ',' ORDER BY id)), 'none') FROM audit_log WHERE created_at <= (:t::timestamptz AT TIME ZONE 'UTC')
UNION ALL SELECT 'stripe events', count(*)::text || ' ' || coalesce(md5(string_agg(id, ',' ORDER BY id)), 'none') FROM stripe_event WHERE received_at <= (:t::timestamptz AT TIME ZONE 'UTC');
