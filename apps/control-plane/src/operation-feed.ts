import type { Pool } from 'pg'

// This is a read projection only. Never copy shared jobs into the legacy queue.
// Executor reasons/journals may contain paths or credentials, so shared reasons
// are stable operator-facing codes; the vendor UI translates these codes.
const SHARED_FIELDS = `j.id,j.control_tenant_id AS tenant_id,
  CASE WHEN j.payload->>'operation' IN ('provision','backup','restore') THEN j.payload->>'operation' ELSE 'unknown' END AS type,
  j.state AS status,
  CASE WHEN j.state IN ('verified','needs_intervention','queued') THEN j.state ELSE COALESCE(e.stage,j.state) END AS stage,
  (j.payload->>'requestId')::uuid AS request_id,
  CASE j.state WHEN 'needs_intervention' THEN 'shared_execution_needs_attention'
    WHEN 'verified' THEN 'shared_execution_verified' ELSE 'shared_execution_pending' END AS reason,
  NULL::jsonb AS result,j.created_at,NULL::timestamptz AS updated_at,'shared'::text AS source,e.created_at AS last_event_at`
const SHARED_FROM = `shared_jobs j LEFT JOIN LATERAL (
  SELECT stage,created_at FROM shared_job_events WHERE job_id=j.id ORDER BY sequence DESC LIMIT 1
) e ON true`

export async function allOperationCounts(pool: Pool) {
  const result = await pool.query(`SELECT
    (SELECT count(*)::int FROM tenants) AS tenants,
    (SELECT count(*)::int FROM tenants WHERE status='active') AS active,
    ((SELECT count(*) FROM operations WHERE status IN ('queued','running')) +
      (SELECT count(*) FROM shared_jobs WHERE state IN ('queued','running')))::int AS pending_operations,
    ((SELECT count(*) FROM operations WHERE status IN ('failed','needs_intervention')) +
      (SELECT count(*) FROM shared_jobs WHERE state='needs_intervention'))::int AS failed_operations,
    (SELECT max(health_checked_at) FROM tenants) AS last_health_at`)
  return result.rows[0]
}

export async function allOperations(pool: Pool, tenantId: string, page: number, statuses: string[] | null) {
  // One snapshot covers page and total, including pages beyond the final row.
  const result = await pool.query(`WITH feed AS (
    SELECT id,tenant_id,type,status,stage,request_id,reason,result,created_at,updated_at,
      'legacy'::text AS source,NULL::timestamptz AS last_event_at
    FROM operations WHERE ($1::uuid IS NULL OR tenant_id=$1::uuid) AND ($3::text[] IS NULL OR status=ANY($3))
    UNION ALL
    SELECT ${SHARED_FIELDS} FROM ${SHARED_FROM}
    WHERE ($1::uuid IS NULL OR j.control_tenant_id=$1::uuid) AND ($3::text[] IS NULL OR j.state=ANY($3))
  ), page AS (
    SELECT * FROM feed ORDER BY created_at DESC,source ASC,id DESC LIMIT 25 OFFSET $2
  ) SELECT totals.total,page.* FROM (SELECT count(*)::int AS total FROM feed) totals
    LEFT JOIN page ON true ORDER BY page.created_at DESC,page.source ASC,page.id DESC`, [tenantId || null, (page - 1) * 25, statuses])
  return { items: result.rows.filter(row => row.id !== null).map(({ total: _total, ...row }) => row), total: result.rows[0].total }
}

export async function sharedOperationDetail(pool: Pool, id: string) {
  const result = await pool.query(`SELECT ${SHARED_FIELDS} FROM ${SHARED_FROM} WHERE j.id=$1`, [id])
  if (!result.rowCount) return null
  const events = await pool.query(`SELECT stage,
    CASE stage WHEN 'prepared' THEN 'running' WHEN 'started' THEN 'running' ELSE stage END AS status,
    created_at AS at FROM shared_job_events WHERE job_id=$1 ORDER BY sequence`, [id])
  return { ...result.rows[0], events: events.rows }
}
