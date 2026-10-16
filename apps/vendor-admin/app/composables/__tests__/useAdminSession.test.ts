import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useAdminSession } from '../useAdminSession'

const profile = { id: 7, email: 'a@example.test', display_name: 'A', roles: ['owner'], capabilities: ['vendor.read'] }
const failure = (statusCode: number) => Object.assign(new Error('fetch failed'), { statusCode })

describe('useAdminSession', () => {
  const fetcher = vi.fn()
  const navigateTo = vi.fn()
  let states: Map<string, ReturnType<typeof ref>>

  beforeEach(() => {
    states = new Map()
    vi.stubGlobal('useState', (key: string, init: () => unknown) => {
      if (!states.has(key)) states.set(key, ref(init()))
      return states.get(key)
    })
    vi.stubGlobal('useRequestFetch', () => fetcher)
    vi.stubGlobal('$fetch', fetcher)
    vi.stubGlobal('navigateTo', navigateTo)
  })
  afterEach(() => { vi.unstubAllGlobals(); fetcher.mockReset(); navigateTo.mockReset() })

  it('loads the profile once for every caller and answers can()', async () => {
    fetcher.mockResolvedValue(profile)
    const first = useAdminSession()
    const second = useAdminSession()
    await Promise.all([first.ready, second.ready])
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith('/api/auth/session')
    expect(first.me.value).toEqual(profile)
    expect(first.can('vendor.read')).toBe(true)
    expect(first.can('vendor.audit.read')).toBe(false)
  })

  it('treats 401 as signed out', async () => {
    fetcher.mockRejectedValue(failure(401))
    const session = useAdminSession()
    await session.ready
    expect(session.me.value).toBeNull()
    expect(session.can('vendor.read')).toBe(false)
  })

  it('surfaces any other failure from ready', async () => {
    fetcher.mockRejectedValue(failure(503))
    await expect(useAdminSession().ready).rejects.toMatchObject({ statusCode: 503 })
  })

  it('refresh reloads the profile', async () => {
    fetcher.mockResolvedValueOnce(profile).mockResolvedValueOnce({ ...profile, roles: ['support'] })
    const session = useAdminSession()
    await session.ready
    await session.refresh()
    expect(session.me.value?.roles).toEqual(['support'])
  })

  it('signOut posts the logout, clears the profile and goes to /login', async () => {
    fetcher.mockResolvedValueOnce(profile).mockResolvedValueOnce(undefined)
    const session = useAdminSession()
    await session.ready
    await session.signOut()
    expect(fetcher).toHaveBeenLastCalledWith('/api/auth/logout', { method: 'POST', body: {} })
    expect(session.me.value).toBeNull()
    expect(navigateTo).toHaveBeenCalledWith('/login')
  })
})
