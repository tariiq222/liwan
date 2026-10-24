import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useNavigationDisclosure } from '../app/composables/useNavigationDisclosure'

function setup(collapsed = false) {
  const scope = effectScope()
  const active = ref<string | null>('meetings')
  const routeKey = ref('/meetings')
  const folded = ref(collapsed)
  const ids = ref(['meetings', 'operations'])
  const state = scope.run(() => useNavigationDisclosure(active, routeKey, folded, ids))!
  return { ...state, scope, active, routeKey, folded, ids }
}

describe('exclusive application disclosure', () => {
  it('opens one application and closes the previous one, including delayed close events', () => {
    const state = setup()
    expect(state.openId.value).toBe('meetings')
    state.setOpen('operations', true)
    state.setOpen('meetings', false)
    expect(state.openId.value).toBe('operations')
    state.setOpen('operations', false)
    expect(state.openId.value).toBe(null)
    state.scope.stop()
  })
  it('does not open a popup during initial collapsed rendering or route changes', async () => {
    const state = setup(true)
    expect(state.openId.value).toBe(null)
    state.setOpen('meetings', true)
    state.setOpen('operations', true)
    expect(state.openId.value).toBe('operations')
    state.routeKey.value = '/meetings?state=done'
    await nextTick()
    expect(state.openId.value).toBe(null)
    state.scope.stop()
  })
  it('opens the routed application after navigation and closes revoked entries', async () => {
    const state = setup()
    state.setOpen('meetings', false)
    state.active.value = 'operations'
    state.routeKey.value = '/operations'
    await nextTick()
    expect(state.openId.value).toBe('operations')
    state.ids.value = ['meetings']
    await nextTick()
    expect(state.openId.value).toBe(null)
    state.setOpen('operations', true)
    expect(state.openId.value).toBe(null)
    state.scope.stop()
  })
})
