import { describe, expect, it, vi, beforeEach } from 'vitest'
import { InboxTikTokConnectSchema } from '@liwan/contracts'
import { inboxTikTokErrorKey, inboxTikTokReasonKey } from '../../../composables/inbox/inboxTikTok'
import { mountScript } from './scriptHarness'

const filename = new URL('../InboxTikTokConnect.vue', import.meta.url)

function mount(options: { connect?: (body: unknown) => Promise<unknown> } = {}) {
  const assign = vi.fn()
  vi.stubGlobal('window', { location: { assign } })
  const connect = vi.fn(options.connect ?? (async () => ({ authorize_url: 'https://auth.example.test/authorize?state=s' })))
  const { state, props } = mountScript(filename, {
    InboxTikTokConnectSchema,
    inboxTikTokErrorKey,
    inboxTikTokReasonKey,
    useConnectInboxTikTok: () => ({ mutateAsync: connect, isPending: false }),
    useInboxDepartments: () => ({ data: { value: { items: [{ id: 3, name: 'المبيعات', members: [] }, { id: 1, name: 'الاستقبال', members: [] }], total: 2 } } }),
  }, {})
  return { state, props, connect, assign }
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('InboxTikTokConnect', () => {
  it('starts closed and opens the inline form instead of a dialog', () => {
    const { state } = mount()
    expect(state.open).toBe(false)
    state.open = true
    expect(state.open).toBe(true)
  })

  it('posts the name and the chosen department, then hands the browser to TikTok', async () => {
    const { state, connect, assign } = mount()
    state.open = true
    state.form.name = '  تيك توك المتجر  '
    state.form.department = '3'
    await state.submit()
    expect(connect).toHaveBeenCalledWith({ name: 'تيك توك المتجر', department_id: 3 })
    expect(assign).toHaveBeenCalledWith('https://auth.example.test/authorize?state=s')
  })

  it('sends no department when none was chosen', async () => {
    const { state, connect } = mount()
    state.form.name = 'تيك توك'
    await state.submit()
    expect(connect).toHaveBeenCalledWith({ name: 'تيك توك', department_id: null })
  })

  it('refuses an empty name before calling the API', async () => {
    const { state, connect } = mount()
    state.form.name = '   '
    await state.submit()
    expect(state.attempted).toBe(true)
    expect(state.valid).toBe(false)
    expect(connect).not.toHaveBeenCalled()
  })

  it('shows the translated reason of a refused connect', async () => {
    const { state, connect } = mount({
      connect: async () => { throw Object.assign(new Error('refused'), { status: 422, details: { reason: 'inbox_tiktok_not_configured' } }) },
    })
    state.form.name = 'تيك توك'
    await state.submit()
    expect(connect).toHaveBeenCalled()
    expect(state.serverError).toBe('inbox.tiktokErrors.inbox_tiktok_not_configured')
  })

  it('keeps the server message for a reason TikTok does not name', async () => {
    const { state } = mount({
      connect: async () => { throw Object.assign(new Error('الرسالة من الخادم'), { status: 500 }) },
    })
    state.form.name = 'تيك توك'
    await state.submit()
    expect(state.serverError).toBe('الرسالة من الخادم')
  })
})
