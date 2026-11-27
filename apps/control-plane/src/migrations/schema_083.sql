-- Removes the retired Package-6 sandbox order tables from a database that applied the old version 8,
-- which created them. Version 8 no longer does, so a fresh database never has them.
-- Runs in the migration transaction: a guard refuses the whole run until no sandbox order rows remain.
DO $$
DECLARE
  payment_event_count bigint;
  order_count bigint;
BEGIN
  IF to_regclass('shared_payment_events') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM shared_payment_events' INTO payment_event_count;
    IF payment_event_count > 0 THEN
      RAISE EXCEPTION 'migration 83 refuses to drop shared_payment_events: % row(s) still exist in the retired Package-6 sandbox table; inspect and clear them or rebuild this database without sandbox order rows, then migrate again', payment_event_count;
    END IF;
  END IF;

  IF to_regclass('shared_orders') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM shared_orders' INTO order_count;
    IF order_count > 0 THEN
      RAISE EXCEPTION 'migration 83 refuses to drop shared_orders: % row(s) still exist in the retired Package-6 sandbox table; inspect and clear them (with shared_order_identity disabled) or rebuild this database without sandbox orders, then migrate again', order_count;
    END IF;
  END IF;
END $$;

-- Order is load-bearing: the child table goes before shared_orders, and the trigger goes before its function.
DROP TABLE IF EXISTS shared_payment_events;
DROP TRIGGER IF EXISTS shared_order_identity ON shared_orders;
DROP FUNCTION IF EXISTS shared_order_quote_immutable();
DROP TABLE IF EXISTS shared_orders;
