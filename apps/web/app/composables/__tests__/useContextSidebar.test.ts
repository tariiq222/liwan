import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

const desktop = ref(true)
const wide = ref(true)
vi.mock('@vueuse/core', () => ({
  useMediaQuery: (query: string) => (query.includes('768') ? desktop : wide),
}))

const shown = ref(false)
vi.mock('../useAssistantSheet', () => ({ useAssistantSheet: () => ({ shown }) }))
const cookie = ref<'open' | 'closed' | null>(null)

beforeEach(() => {
  desktop.value = true
  wide.value = true
  shown.value = false
  cookie.value = null
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useCookie', () => cookie)
  vi.stubGlobal('useHydrated', () => ref(true))
})
afterEach(() => vi.unstubAllGlobals())

describe('useContextSidebar', () => {
  it('collapses while the assistant sheet is open on desktop, without writing the cookie', async () => {
    const { useContextSidebar } = await import('../useShellNavigation')
    const sidebar = useContextSidebar()
    expect(sidebar.expanded.value).toBe(true)
    shown.value = true
    expect(sidebar.expanded.value).toBe(false)
    expect(sidebar.forced.value).toBe(true)
    sidebar.toggle()
    expect(cookie.value).toBeNull()
    shown.value = false
    expect(sidebar.expanded.value).toBe(true)
  })

  it('returns to the saved choice after the sheet closes', async () => {
    const { useContextSidebar } = await import('../useShellNavigation')
    cookie.value = 'closed'
    const sidebar = useContextSidebar()
    shown.value = true
    expect(sidebar.expanded.value).toBe(false)
    shown.value = false
    expect(sidebar.expanded.value).toBe(false)
    expect(cookie.value).toBe('closed')
  })

  it('does not force below 768px, where the sheet is a full-screen layer', async () => {
    const { useContextSidebar } = await import('../useShellNavigation')
    desktop.value = false
    shown.value = true
    const sidebar = useContextSidebar()
    expect(sidebar.forced.value).toBe(false)
    expect(sidebar.expanded.value).toBe(true)
  })
})
