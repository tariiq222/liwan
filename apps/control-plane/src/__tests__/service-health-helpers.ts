import type { Pool } from 'pg'

/** Move a component's beat into the past on the database clock, the way time passing would. */
export const backdateBeat = (pool: Pick<Pool, 'query'>, component: string, ms: number) =>
  pool.query("UPDATE service_heartbeats SET beat_at = beat_at - make_interval(secs => $2::float / 1000) WHERE component = $1", [component, ms])
