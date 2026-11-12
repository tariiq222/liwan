import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../useApi'
import { useSwitchCompany } from '../useSwitchCompany'
import { companySwitching } from '../../utils/companySwitch'

function setup(post: () => Promise<unknown>, meAfterRefresh: number | null = 2, blocked = false) {
  const calls: string[] = []
  const me = { value: { company: { id: 1 } } as { company: { id: number } } | null }
  const $api = vi.fn(async (path: string, options: unknown) => { calls.push('post'); expect(path).toBe('/api/v1/me/company'); expect(options).toMatchObject({ method: 'POST', body: { company_id: 2 } }); return post() })
  vi.stubGlobal('useApi', () => ({ $api }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useNuxtData', () => ({ data: me }))
  vi.stubGlobal('useBus', () => ({ disconnect: () => calls.push('disconnect'), connect: () => calls.push('connect') }))
  vi.stubGlobal('refreshNuxtData', vi.fn(async (keys: string[]) => { calls.push(`refresh:${keys.join(',')}`); if (meAfterRefresh !== null) me.value = { company: { id: meAfterRefresh } } }))
  const route = { path: '/leave' }
  vi.stubGlobal('useRouter', () => ({ currentRoute: { value: route } }))
  vi.stubGlobal('navigateTo', vi.fn(async (to: string) => { calls.push(`go:${to}`); if (!blocked) route.path = to }))
  return { calls, $api, switchCompany: useSwitchCompany() }
}

afterEach(() => { vi.unstubAllGlobals(); companySwitching.value = false })

describe('useSwitchCompany', () => {
  it('posts the switch without stating a company, reloads me and branding, reconnects the live socket, then goes home', async () => {
    const { calls, $api, switchCompany } = setup(async () => ({}))
    await switchCompany(2)
    expect(calls).toEqual(['go:/', 'post', 'refresh:me,branding', 'disconnect', 'connect'])
    expect($api.mock.calls[0]![1]).toMatchObject({ statesCompany: false })
    expect(companySwitching.value).toBe(false)
  })

  it('sends nothing, reloads nothing and frees the flag when a guard keeps the person on the page (an unsaved draft)', async () => {
    const { calls, $api, switchCompany } = setup(async () => ({}), 2, true)
    await switchCompany(2)
    expect(calls).toEqual(['go:/'])
    expect($api).not.toHaveBeenCalled()
    expect(companySwitching.value).toBe(false)
    await switchCompany(2)
    expect(calls).toEqual(['go:/', 'go:/'])
  })

  it('does nothing for a second switch while one is running', async () => {
    let release!: () => void
    const { calls, $api, switchCompany } = setup(() => new Promise<void>(resolve => { release = resolve }))
    const first = switchCompany(2)
    expect(companySwitching.value).toBe(true)
    await switchCompany(3)
    expect($api).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(calls.filter(call => call === 'post')).toHaveLength(1)
    expect(calls.filter(call => call === 'go:/')).toHaveLength(1)
    expect(companySwitching.value).toBe(false)
  })

  it('changes nothing when the server refuses the switch, and frees the next one', async () => {
    const refusal = new ApiError(404, 'not_found', 'غير موجود')
    const { calls, switchCompany } = setup(async () => { throw refusal })
    await expect(switchCompany(2)).rejects.toBe(refusal)
    expect(calls).toEqual(['go:/', 'post'])
    expect(companySwitching.value).toBe(false)
  })

  it.each([[null], [1]])('does not reconnect or navigate when me does not name the requested company after the reload (%s)', async (after) => {
    const { calls, switchCompany } = setup(async () => ({}), after)
    await expect(switchCompany(2)).rejects.toThrow('errors.generic')
    expect(calls).toEqual(['go:/', 'post', 'refresh:me,branding'])
    expect(companySwitching.value).toBe(false)
  })
})
