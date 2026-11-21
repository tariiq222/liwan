import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(import.meta.dirname, '../crm/opportunities/[id].vue'), 'utf8')

// The page keeps per-record state (open panel, sale draft, refusals, assignee); a route change from one opportunity id to
// another must remount it, while a query or hash change on the same record must not.
describe('crm opportunity page', () => {
  it('is keyed by the opportunity id only', () => {
    expect(source).toContain('definePageMeta({ key: route => `crm-opportunity-${String(route.params.id)}` })')
  })
})
