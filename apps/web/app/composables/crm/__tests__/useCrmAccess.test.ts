import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The create right needs the server answer and a write capability: nothing is guessed while it loads or when it fails.
let answer: { data?: { can_create: boolean }, isPending: boolean, fetchStatus: string } = { isPending: true, fetchStatus: 'fetching' }
const useQuery = vi.fn((options: unknown) => ({
  data: Vue.ref(answer.data), isPending: Vue.ref(answer.isPending), fetchStatus: Vue.ref(answer.fetchStatus), options,
}))
vi.mock('@tanstack/vue-query', () => ({ useQuery }))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
let canWork = true
let canAssign = true
vi.stubGlobal('useAccess', () => ({
  can: (key: string) => (key === 'crm.leads.work' ? canWork : key === 'crm.leads.assign' ? canAssign : true),
}))
vi.stubGlobal('useMe', () => ({ me: Vue.ref({ company: { id: 4 } }) }))
vi.stubGlobal('computed', Vue.computed)

const { useCrmCreateAccess } = await import('../useCrmAccess')

describe('useCrmCreateAccess', () => {
  beforeEach(() => {
    useQuery.mockClear()
    canWork = true
    canAssign = true
  })

  it('is closed and pending while the answer loads', () => {
    answer = { isPending: true, fetchStatus: 'fetching' }
    const access = useCrmCreateAccess()
    expect([access.canCreate.value, access.pending.value]).toEqual([false, true])
  })

  it('follows can_create from the server', () => {
    answer = { data: { can_create: true }, isPending: false, fetchStatus: 'idle' }
    expect(useCrmCreateAccess().canCreate.value).toBe(true)
    answer = { data: { can_create: false }, isPending: false, fetchStatus: 'idle' }
    expect(useCrmCreateAccess().canCreate.value).toBe(false)
  })

  it('stays closed when the server allows it but the user holds no write capability (a read-only tenant)', () => {
    answer = { data: { can_create: true }, isPending: false, fetchStatus: 'idle' }
    canWork = false
    canAssign = false
    const access = useCrmCreateAccess()
    expect([access.canCreate.value, access.manualOnly.value]).toEqual([false, false])
    canAssign = true
    expect(useCrmCreateAccess().canCreate.value).toBe(true)
  })

  it('stays closed and not pending when the query is off or failed', () => {
    answer = { isPending: true, fetchStatus: 'idle' }
    const access = useCrmCreateAccess()
    expect([access.canCreate.value, access.pending.value]).toEqual([false, false])
  })

  it('names manual distribution only for a refused user who holds crm.leads.work, never on a failed request', () => {
    answer = { data: { can_create: false }, isPending: false, fetchStatus: 'idle' }
    expect(useCrmCreateAccess().manualOnly.value).toBe(true)
    canWork = false
    expect(useCrmCreateAccess().manualOnly.value).toBe(false)
    canWork = true
    answer = { isPending: false, fetchStatus: 'idle' }
    expect(useCrmCreateAccess().manualOnly.value).toBe(false)
  })
})
