import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useShellNavigation } from '../useShellNavigation'

function navigation(path: string, capabilities: string[]) {
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('useRoute', () => ({ path, fullPath: path, query: {}, hash: '' }))
  vi.stubGlobal('useHydrated', () => ref(true))
  vi.stubGlobal('useSettingsActivePart', () => ref(null))
  return useShellNavigation({ capabilities })
}

afterEach(() => vi.unstubAllGlobals())

describe('shell navigation on a page the identity may not open', () => {
  it('shows no application chrome on /ai without the assistant capability', () => {
    const { activeModule, contextLinks } = navigation('/ai', ['webvue.internal'])
    expect(activeModule.value).toBeNull()
    expect(contextLinks.value).toEqual([])
  })

  it('keeps the application for an identity that may open its page', () => {
    expect(navigation('/ai', ['webvue.internal', 'ai.use']).activeModule.value).toBe('ai')
  })
})
