import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxAvailabilitySwitch.vue', import.meta.url)
const self = { id: 1, name: 'أنا', available: true, in_shift: true, effective_available: true }

function mount(options: { items?: unknown[]; can?: boolean } = {}) {
  const setAvailability = vi.fn()
  const { state } = mountScript(filename, {
    useMe: () => ({ me: Vue.ref({ id: 1 }) }),
    useAccess: () => ({ can: () => options.can ?? true }),
    useInboxAgents: () => ({ data: Vue.ref({ items: options.items ?? [self] }) }),
    useSetInboxAgentAvailability: () => ({ mutate: setAvailability, isPending: Vue.ref(false) }),
    inboxAgentStatus: (agent: { available: boolean; in_shift: boolean }) => (!agent.available ? 'unavailable' : agent.in_shift ? 'available' : 'off_shift'),
  }, {})
  return { state, setAvailability }
}

describe('InboxAvailabilitySwitch', () => {
  it('finds the signed-in agent and names the status', () => {
    expect(mount().state.status).toBe('available')
    expect(mount({ items: [{ ...self, available: false }] }).state.status).toBe('unavailable')
    expect(mount({ items: [{ ...self, in_shift: false }] }).state.status).toBe('off_shift')
  })

  it('draws nothing when the user is not in the agents list', () => {
    expect(mount({ items: [{ ...self, id: 9 }] }).state.self).toBeUndefined()
  })

  it('sends the user own id with the chosen availability', () => {
    const { state, setAvailability } = mount()
    state.change(false)
    expect(setAvailability).toHaveBeenCalledWith({ userId: 1, available: false }, expect.any(Object))
  })

  it('does not send for a user missing from the list', () => {
    const { state, setAvailability } = mount({ items: [] })
    state.change(false)
    expect(setAvailability).not.toHaveBeenCalled()
  })
})
