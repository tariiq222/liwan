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

function setup(fetch: ReturnType<typeof vi.fn>) {
  const states = new Map<string, ReturnType<typeof Vue.ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, Vue.ref(init()))
    return states.get(key)
  })
  const me = Vue.ref({ id: 7, login: 'synthetic', company: { id: 1, name: 'Synthetic' } })
  vi.stubGlobal('useMe', () => ({ me }))
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
  refresh.mockReset().mockResolvedValue(undefined)
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
  expect(refresh).toHaveBeenCalledWith('me')
  expect(navigate).toHaveBeenCalledWith('/login')
})

it('keeps the local state and resolves false when the server cannot end the session', async () => {
  const { signOut } = setup(vi.fn().mockRejectedValue(new Error('logout_failed')))
  await expect(signOut()).resolves.toBe(false)
  expect(removeItem).not.toHaveBeenCalled()
  expect(clearAiSessionState).not.toHaveBeenCalled()
  expect(clearChatDrafts).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled()
  expect(navigate).not.toHaveBeenCalled()
  expect(refresh).toHaveBeenCalledWith('me')
})
