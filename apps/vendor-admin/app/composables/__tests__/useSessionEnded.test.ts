import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useSessionEnded } from '../useSessionEnded'

describe('useSessionEnded', () => {
  const me = ref<unknown>({ id: 7 })
  const navigateTo = vi.fn()
  let fullPath = '/'
  beforeEach(() => {
    me.value = { id: 7 }
    vi.stubGlobal('useAdminMe', () => me)
    vi.stubGlobal('useRouter', () => ({ currentRoute: { get value() { return { fullPath } } } }))
    vi.stubGlobal('navigateTo', navigateTo)
  })
  afterEach(() => { vi.unstubAllGlobals(); navigateTo.mockReset() })

  it('forgets the profile and returns to the page open at the moment the session ended', () => {
    const end = useSessionEnded()
    fullPath = '/customers?q=a'
    end()
    expect(me.value).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith({ path: '/login', query: { next: '/customers?q=a' } })
  })

  it('sends no next for the home page or for an unsafe or sign-in path', () => {
    const end = useSessionEnded()
    for (const path of ['/', '/login?next=/x', '//evil.example']) {
      fullPath = path
      end()
      expect(navigateTo).toHaveBeenLastCalledWith({ path: '/login', query: {} })
    }
  })
})
