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

it('defaults to collapsed on tablet without persisting resize, and honors explicit choices', () => {
  const cookie = ref<ContextSidebarCookie | null>(null)
  const wide = ref(false)
  const state = contextSidebarState(cookie, ref(true), wide)
  expect(state.expanded.value).toBe(false)
  wide.value = true
  expect(state.expanded.value).toBe(true)
  expect(cookie.value).toBeNull()
  wide.value = false
  state.toggle()
  expect(cookie.value).toBe('open')
  expect(state.expanded.value).toBe(true)
  wide.value = true
  state.toggle()
  wide.value = false
  expect(state.expanded.value).toBe(false)
  expect(cookie.value).toBe('closed')
})

describe('forced collapse (a docked layer needs the room)', () => {
  it('collapses whatever the preference is, and returns to it when released', () => {
    const cookie = ref<ContextSidebarCookie | null>('open')
    const forced = ref(false)
    const state = contextSidebarState(cookie, ref(true), ref(true), forced)
    expect(state.expanded.value).toBe(true)
    forced.value = true
    expect(state.expanded.value).toBe(false)
    expect(state.preference.value).toBe('open')
    forced.value = false
    expect(state.expanded.value).toBe(true)
  })

  it('returns to the automatic rule when the user never chose', () => {
    const wide = ref(true)
    const forced = ref(true)
    const state = contextSidebarState(ref(null), ref(true), wide, forced)
    expect(state.expanded.value).toBe(false)
    forced.value = false
    expect(state.expanded.value).toBe(true)
    wide.value = false
    expect(state.expanded.value).toBe(false)
  })

  it('ignores a toggle while forced, then toggles from the user own state', () => {
    const cookie = ref<ContextSidebarCookie | null>('open')
    const forced = ref(true)
    const state = contextSidebarState(cookie, ref(true), ref(true), forced)
    state.toggle()
    expect(cookie.value).toBe('open')
    forced.value = false
    state.toggle()
    expect(cookie.value).toBe('closed')
  })

  it('a user-collapsed sidebar stays collapsed after release and toggles open', () => {
    const cookie = ref<ContextSidebarCookie | null>('closed')
    const forced = ref(true)
    const state = contextSidebarState(cookie, ref(true), ref(true), forced)
    expect(state.expanded.value).toBe(false)
    forced.value = false
    expect(state.expanded.value).toBe(false)
    state.toggle()
    expect(cookie.value).toBe('open')
  })
})
