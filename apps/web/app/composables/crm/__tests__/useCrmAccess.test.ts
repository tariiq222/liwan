import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The create right comes from the server answer alone: nothing is guessed while it loads, when it fails or from the capabilities.
let answer: { data?: { can_create: boolean }, isPending: boolean, fetchStatus: string } = { isPending: true, fetchStatus: 'fetching' }
const useQuery = vi.fn((options: unknown) => ({
  data: Vue.ref(answer.data), isPending: Vue.ref(answer.isPending), fetchStatus: Vue.ref(answer.fetchStatus), options,
}))
vi.mock('@tanstack/vue-query', () => ({ useQuery }))
vi.stubGlobal('useApi', () => ({ $api: vi.fn() }))
let canWork = true
vi.stubGlobal('useAccess', () => ({ can: (key: string) => key !== 'crm.leads.work' || canWork }))
vi.stubGlobal('useMe', () => ({ me: Vue.ref({ company: { id: 4 } }) }))
vi.stubGlobal('computed', Vue.computed)

const { useCrmCreateAccess } = await import('../useCrmAccess')

describe('useCrmCreateAccess', () => {
  beforeEach(() => {
    useQuery.mockClear()
    canWork = true
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
