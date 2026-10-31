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
const path = ref('/chat')

beforeEach(() => {
  desktop.value = true
  wide.value = true
  shown.value = false
  cookie.value = null
  path.value = '/chat'
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useCookie', () => cookie)
  vi.stubGlobal('useHydrated', () => ref(true))
  vi.stubGlobal('useRoute', () => ({ get path() { return path.value } }))
})
afterEach(() => vi.unstubAllGlobals())

describe('useContextSidebar', () => {
  it('opens by itself only for an application with a side panel', async () => {
    const { useContextSidebar } = await import('../useShellNavigation')
    const sidebar = useContextSidebar()
    expect(sidebar.expanded.value).toBe(true)
    path.value = '/my-tasks'
    expect(sidebar.expanded.value).toBe(false)
  })

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
