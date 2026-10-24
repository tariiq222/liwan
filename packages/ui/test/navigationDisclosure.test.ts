import { describe, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useNavigationDisclosure, useNavigationPathDisclosure } from '../app/composables/useNavigationDisclosure'

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

describe('exclusive nested navigation path', () => {
  it('keeps ancestors open, replaces siblings and closes a whole descendant branch', async () => {
    const scope = effectScope()
    const active = ref(['settings', 'team', 'users'])
    const routeKey = ref('/settings/team/users')
    const collapsed = ref(false)
    const allowed = ref([['settings', 'team'], ['settings', 'team', 'users'], ['settings', 'company'], ['finance', 'sales']])
    const state = scope.run(() => useNavigationPathDisclosure(active, routeKey, collapsed, allowed))!
    expect(state.openPath.value).toEqual(['settings', 'team', 'users'])
    state.setOpen(['settings', 'team', 'users'], false)
    expect(state.openPath.value).toEqual(['settings', 'team'])
    state.setOpen(['settings', 'company'], true)
    expect(state.openPath.value).toEqual(['settings', 'company'])
    state.setOpen(['settings', 'team', 'users'], true)
    state.setOpen(['settings', 'team'], false)
    expect(state.openPath.value).toEqual([])
    active.value = ['settings', 'team', 'users']
    await nextTick()
    expect(state.openPath.value).toEqual([]) // an equivalent model refresh must not undo a manual close
    routeKey.value = '/settings/team/users?status=active'
    await nextTick()
    expect(state.openPath.value).toEqual(['settings', 'team', 'users'])
    allowed.value = [['settings', 'team']]
    await nextTick()
    expect(state.openPath.value).toEqual(['settings', 'team'])
    collapsed.value = true
    await nextTick()
    expect(state.openPath.value).toEqual([])
    state.setOpen(['finance', 'sales'], true)
    expect(state.openPath.value).toEqual([])
    scope.stop()
  })
})
