-- Service health: one row per reporting component, updated in place (no history; the table never grows). The shared worker and the
-- commercial scheduler write a beat; an adapter row records whether it could be built. `detail` holds fixed codes only.
CREATE TABLE service_heartbeats(
  component text PRIMARY KEY,
  beat_at timestamptz NOT NULL,
  started_at timestamptz NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(detail) = 'object')
);

-- The state of every component at one instant. This function is the single place the staleness thresholds live: the control plane reads it
-- for the console and the host alert timer reads it directly, so the two cannot disagree.
--   shared_worker: stale after 2 minutes without a beat (its beat is a timer of its own).
--   commercial_scheduler: stale after 5 minutes without a beat, but after 2 hours while a shared job runs (the tick does not run then). A job counts
--     only while its own lease is unexpired (the worker renews it while it works), so a row left in `running` by a hung or dead worker gives no grace.
--   adapters: ok or unavailable as recorded; never stale.
-- `down` is the alert condition: stale or unavailable, except an adapter row of the worker while the worker itself is not ok
-- (it is the worker that is down, and the adapter's last record is then unknown).
-- Least privilege: the host alert timer reads this function with a role of its own that holds EXECUTE on it and nothing else. The function
-- is SECURITY DEFINER (it runs as its owner, the role that migrates) rather than the role being granted SELECT on the tables, because it
-- also reads `shared_jobs` (payloads, journals, receipts) of which it returns nothing but a yes or no. `search_path` is pinned, with
-- `pg_temp` last, so a caller cannot shadow a table or an operator. EXECUTE is revoked from PUBLIC: the operator grants it to the role
-- (docs/operations/environment-bringup.md A6.3).
CREATE FUNCTION service_health_states(at timestamptz) RETURNS TABLE(component text, state text, since timestamptz, last_beat_at timestamptz, detail jsonb, down boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
  WITH known(component, beat, worker_adapter, stale_after) AS (VALUES
    ('shared_worker', true, false, interval '2 minutes'),
    ('commercial_scheduler', true, false, CASE WHEN EXISTS (SELECT 1 FROM shared_jobs WHERE state = 'running' AND lease_until > at) THEN interval '2 hours' ELSE interval '5 minutes' END),
    ('payment_adapter', false, true, NULL::interval),
    ('mail_adapter', false, true, NULL::interval),
    ('alert_channel', false, true, NULL::interval),
    ('api_payment_adapter', false, false, NULL::interval)
  ), states AS (
    SELECT k.component, k.worker_adapter, h.started_at AS since, h.beat_at AS last_beat_at, h.detail,
      CASE WHEN h.component IS NULL THEN 'never_seen'
        WHEN k.beat THEN CASE WHEN at - h.beat_at > k.stale_after THEN 'stale' ELSE 'ok' END
        WHEN h.detail->>'available' = 'true' THEN 'ok' ELSE 'unavailable' END AS state
    FROM known k LEFT JOIN service_heartbeats h ON h.component = k.component
  )
  SELECT s.component, s.state, s.since, s.last_beat_at, s.detail,
    s.state IN ('stale', 'unavailable') AND (NOT s.worker_adapter OR (SELECT w.state FROM states w WHERE w.component = 'shared_worker') = 'ok') AS down
  FROM states s
$$;
REVOKE ALL ON FUNCTION service_health_states(timestamptz) FROM PUBLIC;
