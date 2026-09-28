import { readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
it('declares event ownership validation and terminal receipt immutability', async () => {
  const sql=await readFile(new URL('../schema_006.sql',import.meta.url),'utf8')
  expect(sql).toContain('shared_job_event_owner')
  expect(sql).toContain('NEW.attempt_id IS DISTINCT FROM current_job.attempt_id')
  expect(sql).toContain('NEW.fence <> current_job.fence')
  expect(sql).toContain("IF OLD.state='verified'")
})
