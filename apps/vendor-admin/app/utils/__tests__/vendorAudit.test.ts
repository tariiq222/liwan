import { describe, expect, it } from 'vitest'
import { auditActionParts, auditActor, auditFilterCount, auditFilters, auditListQuery, auditSubjectTo } from '../vendorAudit'

const ID = '10000000-0000-4000-8000-000000000001'
const ref = (kind: string, over: Record<string, unknown> = {}) => ({ subject: 's/1', subject_ref: { kind, name: 'N', customer_id: null, tenant_id: null, ...over } }) as never

describe('vendorAudit', () => {
  it('reads valid URL filters and drops anything the control plane would reject', () => {
    expect(auditFilters({ q: 'acme', action: 'order', actor: 'layla', customer_id: ID, from: '2026-10-01', to: '2026-10-05' })).toEqual({ q: 'acme', action: 'order', actor: 'layla', customer_id: ID, from: '2026-10-01', to: '2026-10-05' })
    expect(auditFilters({ q: '', action: 'Bad Value', customer_id: 'x', from: '2026-13-01', to: ['2026-10-05'], page: '2', subject: 'y' })).toEqual({ to: '2026-10-05' })
    expect(auditFilters({ from: '2026-10-05', to: '2026-10-01' })).toEqual({ from: '2026-10-05' })
  })
  it('builds the API query with the page only after the first', () => {
    expect(auditListQuery({ q: 'a' }, 1)).toEqual({ q: 'a', page: undefined })
    expect(auditListQuery({}, 3)).toEqual({ page: '3' })
    expect(auditFilterCount({ q: 'a', from: '2026-10-01' })).toBe(2)
  })
  it('splits operation actions and leaves others to the locale', () => {
    expect(auditActionParts('operation.tenant.create.failed')).toEqual({ type: 'tenant.create', status: 'failed' })
    expect(auditActionParts('operation.health.queued')).toEqual({ type: 'health', status: 'queued' })
    expect(auditActionParts('order.accepted')).toBeNull()
    expect(auditActionParts('operation.unknown.queued')).toBeNull()
  })
  it('names the actor from the account, a system actor, a former account, or the raw value', () => {
    expect(auditActor({ actor: 'account:2', actor_name: 'Layla' })).toEqual({ kind: 'name', name: 'Layla' })
    expect(auditActor({ actor: 'operator', actor_name: null })).toEqual({ kind: 'system', key: 'operator' })
    expect(auditActor({ actor: 'legacy-uid:nasq:2', actor_name: null })).toEqual({ kind: 'legacy', id: 'nasq:2' })
    expect(auditActor({ actor: 'someone', actor_name: null })).toEqual({ kind: 'raw', id: 'someone' })
  })
  it('opens only the subjects the console has a page for', () => {
    expect(auditSubjectTo(ref('customer', { customer_id: ID }))).toEqual({ path: `/customers/${ID}` })
    expect(auditSubjectTo(ref('order', { customer_id: ID }))).toEqual({ path: `/customers/${ID}` })
    expect(auditSubjectTo(ref('tenant', { customer_id: ID, tenant_id: 't' }))).toEqual({ path: `/customers/${ID}`, query: { tab: 'workspace' } })
    expect(auditSubjectTo(ref('tenant', { tenant_id: 't 1' }))).toEqual({ path: '/tenants/t%201' })
    expect(auditSubjectTo(ref('plan'))).toEqual({ path: '/plans/s%2F1' })
    expect(auditSubjectTo(ref('account'))).toBeNull()
    expect(auditSubjectTo(ref('other'))).toBeNull()
  })
})
