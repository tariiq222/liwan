import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxAgentsSection.vue', import.meta.url)

function mount(can: (key: string) => boolean = () => true) {
  const { state } = mountScript(filename, {
    useMe: () => ({ me: Vue.ref({ id: 1 }) }),
    useAccess: () => ({ can }),
    useInboxAgents: () => ({ data: Vue.ref({ items: [{ id: 1 }, { id: 2 }] }), isLoading: Vue.ref(false), error: Vue.ref(null), refetch: () => {} }),
    useInboxSettings: () => ({ data: Vue.ref({ agent_shifts_enabled: true }) }),
    useSetInboxAgentAvailability: () => ({ mutate: () => {}, isPending: Vue.ref(false) }),
    InboxAgentShiftsForm: {}, INBOX_AGENT_STATUS_TONE: {}, inboxAgentStatus: () => 'available',
  }, {})
  return state
}

describe('InboxAgentsSection shift editor guard', () => {
  it('opens another agent at once while the open draft is clean', () => {
    const state = mount()
    state.requestShifts(1)
    state.requestShifts(2)
    expect(state.openShifts).toBe(2)
    expect(state.pendingShifts).toBeNull()
  })

  it('asks before leaving a dirty draft, keeps it on cancel and drops it on confirm', () => {
    const state = mount()
    state.requestShifts(1)
    state.shiftsDirty = true
    state.requestShifts(2)
    expect(state.openShifts).toBe(1)
    expect(state.pendingShifts).toEqual({ target: 2 })
    state.pendingShifts = null
    expect(state.openShifts).toBe(1)
    state.requestShifts(null)
    state.discardShifts()
    expect(state.openShifts).toBeNull()
    expect(state.pendingShifts).toBeNull()
  })

  it('guards collapsing the open agent the same way', () => {
    const state = mount()
    state.requestShifts(1)
    state.shiftsDirty = true
    state.requestShifts(1)
    expect(state.pendingShifts).toEqual({ target: null })
    expect(state.openShifts).toBe(1)
  })

  it('shows the shift editor to settings managers only', () => {
    expect(mount().shiftsOn).toBe(true)
    expect(mount(key => key === 'inbox.conversations.assign').shiftsOn).toBe(false)
  })
})
