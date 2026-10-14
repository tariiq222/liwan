import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { contextSidebarState, type ContextSidebarCookie } from '../contextSidebarState'

describe('context sidebar state', () => {
  it.each([[undefined, true], [null, true], ['open', true], ['closed', false], ['garbage', true]] as const)('cookie %s is expanded: %s', (value, expanded) => {
    const state = contextSidebarState(ref(value as ContextSidebarCookie | null | undefined), ref(true))
    expect(state.expanded.value).toBe(expanded)
  })

  it('ignores a toggle before hydration and persists every toggle after it', () => {
    const cookie = ref<ContextSidebarCookie | null | undefined>('open')
    const hydrated = ref(false)
    const state = contextSidebarState(cookie, hydrated)
    state.toggle()
    expect(cookie.value).toBe('open')
    hydrated.value = true
    state.toggle()
    expect(cookie.value).toBe('closed')
    expect(state.expanded.value).toBe(false)
    state.toggle()
    expect(cookie.value).toBe('open')
  })
})
