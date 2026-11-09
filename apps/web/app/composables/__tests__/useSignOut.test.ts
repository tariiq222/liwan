import * as Vue from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAiConversation } from '../useAiConversation'
import { useSignOut } from '../useSignOut'

const cancelQueries = vi.fn()
const clear = vi.fn()
const clearAiSessionState = vi.fn()
const clearChatDrafts = vi.fn()
vi.mock('@tanstack/vue-query', () => ({ useQueryClient: () => ({ cancelQueries, clear }) }))
vi.mock('../../utils/aiDraft', () => ({ clearAiSessionState: () => clearAiSessionState() }))
vi.mock('../../utils/chatDrafts', () => ({ clearChatDrafts: () => clearChatDrafts() }))

const navigate = vi.fn()
const removeItem = vi.fn()
const refresh = vi.fn()
/** The `me` entry Nuxt's data cache resolves for a manual refresh: the same identity a signed-in person is leaving. */
const nuxtMe = Vue.ref<{ id: number } | null>({ id: 7 })
let logoutFailed = false

function setup(fetch: ReturnType<typeof vi.fn>) {
  const states = new Map<string, ReturnType<typeof Vue.ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, Vue.ref(init()))
    return states.get(key)
  })
  const me = Vue.ref({ id: 7, login: 'synthetic', company: { id: 1, name: 'Synthetic' } })
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('useNuxtData', (key: string) => {
    expect(key, 'the sign-out clears the shared me entry').toBe('me')
    return { data: nuxtMe }
  })
  // After the server ended the session, a refresh that still resolves the old user is the loop: the guard re-reads
  // `me` and that stale identity sends the sign-in page back to the root. The failure path keeps the session, so it
  // is only a failure there when the logout itself succeeded.
  refresh.mockImplementation(async () => {
    if (fetch.getMockImplementation() && !logoutFailed) {
      expect(nuxtMe.value, '/api/v1/me refused the session, so no identity may survive the sign-out').toBeNull()
    }
  })
  vi.stubGlobal('sessionStorage', { removeItem })
  vi.stubGlobal('$fetch', fetch)
  vi.stubGlobal('refreshNuxtData', refresh)
  vi.stubGlobal('navigateTo', navigate)
  const scope = Vue.effectScope()
  return scope.run(() => ({ signOut: useSignOut(), conversation: useAiConversation() }))!
}

beforeEach(() => {
  cancelQueries.mockReset()
  clear.mockReset()
  clearAiSessionState.mockReset()
  clearChatDrafts.mockReset()
  navigate.mockReset()
  removeItem.mockReset()
  refresh.mockReset()
  logoutFailed = false
  nuxtMe.value = { id: 7 }
})
afterEach(() => vi.unstubAllGlobals())

it('ends the session, forgets the local state of the user and goes to sign-in', async () => {
  const fetch = vi.fn().mockResolvedValue({})
  const { signOut, conversation } = setup(fetch)
  conversation.currentRunId.value = 'previous-identity-run'
  cancelQueries.mockImplementation(async () => { expect(conversation.currentRunId.value).toBeNull() })
  await expect(signOut()).resolves.toBe(true)
  expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', body: {} })
  expect(removeItem).toHaveBeenCalledWith('liwan-nav:7')
  expect(clearAiSessionState).toHaveBeenCalledTimes(1)
  expect(clearChatDrafts).toHaveBeenCalledTimes(1)
  expect(cancelQueries).toHaveBeenCalledTimes(1)
  expect(clear).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith('/login')
})

/** The regression this pins: the app landed on `/` showing the old identity and re-requested `/api/v1/me` ~71 times. */
it('records the ended session as no identity before the sign-in navigation', async () => {
  const { signOut } = setup(vi.fn().mockResolvedValue({}))
  const identitiesAtNavigation: Array<unknown> = []
  navigate.mockImplementation(() => { identitiesAtNavigation.push(nuxtMe.value) })
  await expect(signOut()).resolves.toBe(true)
  expect(nuxtMe.value, 'the shared me entry must be null, not the signed-out user').toBeNull()
  expect(identitiesAtNavigation, 'the guard already sees no identity when it runs').toEqual([null])
})

it('keeps the local state and resolves false when the server cannot end the session', async () => {
  logoutFailed = true
  const { signOut } = setup(vi.fn().mockRejectedValue(new Error('logout_failed')))
  await expect(signOut()).resolves.toBe(false)
  expect(removeItem).not.toHaveBeenCalled()
  expect(clearAiSessionState).not.toHaveBeenCalled()
  expect(clearChatDrafts).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  // A session that still exists keeps its identity: the failure path never claims the user is gone.
  expect(nuxtMe.value).toEqual({ id: 7 })
  expect(refresh).toHaveBeenCalledWith('me')
})
