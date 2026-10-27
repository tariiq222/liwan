import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import { useAiConversation } from '../../composables/useAiConversation'

afterEach(() => vi.unstubAllGlobals())

async function renderLogout(fetch: ReturnType<typeof vi.fn>) {
  const states = new Map<string, ReturnType<typeof Vue.ref>>()
  vi.stubGlobal('useState', (key: string, init: () => unknown) => {
    if (!states.has(key)) states.set(key, Vue.ref(init()))
    return states.get(key)
  })
  const me = Vue.ref({ id: 7, login: 'synthetic', company: { id: 1, name: 'Synthetic' } })
  vi.stubGlobal('useMe', () => ({ me }))
  vi.stubGlobal('sessionStorage', { removeItem: vi.fn() })
  const scope = Vue.effectScope()
  const conversation = scope.run(() => useAiConversation())!
  conversation.currentRunId.value = 'previous-identity-run'
  const cancelQueries = vi.fn(async () => { expect(conversation.currentRunId.value).toBeNull() })
  const clear = vi.fn()
  const navigate = vi.fn()
  const addToast = vi.fn()
  const clearAiSessionState = vi.fn()
  const clearChatDrafts = vi.fn()
  let click!: () => Promise<void>
  const UButton = Vue.defineComponent({
    inheritAttrs: false, props: { label: String },
    setup: (props, { attrs }) => {
      if (props.label === 'nav.logout') click = attrs.onClick as () => Promise<void>
      return () => Vue.h('button', attrs, props.label)
    },
  })
  const container = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
  await renderShared(resolve(import.meta.dirname, '../account/settings.vue'), {}, {}, {
    stubs: { ...DEFAULT_STUBS, UButton, SharedSettingsPage: container, SharedPageHeader: container, SharedPropertiesPanel: container, SharedPropertyRow: container, SharedFormSection: container },
    globals: {
      useMe: () => ({ me }), useCookie: () => Vue.ref(null),
      useAppearance: () => ({ mode: Vue.ref('light'), fontSize: Vue.ref('medium'), setMode: vi.fn(), setFontSize: vi.fn() }),
      useToast: () => ({ add: addToast }),
      $fetch: fetch, refreshNuxtData: vi.fn().mockResolvedValue(undefined), navigateTo: navigate,
    },
    modules: {
      '@/components/account/PasswordForm.vue': { __esModule: true, default: container },
      '@tanstack/vue-query': { useQueryClient: () => ({ cancelQueries, clear }) },
      '@/utils/aiDraft': { clearAiSessionState },
      '@/utils/chatDrafts': { clearChatDrafts },
      '@/composables/useAiConversation': { useAiConversation },
    },
  })
  return { click, conversation, clear, navigate, addToast, clearAiSessionState, clearChatDrafts }
}

it('clears the shared assistant conversation on successful logout before identity refresh completes', async () => {
  const fetch = vi.fn().mockResolvedValue({})
  const page = await renderLogout(fetch)
  await page.click()
  expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', body: {} })
  expect(page.conversation.currentRunId.value).toBeNull()
  expect(page.clear).toHaveBeenCalledTimes(1)
  expect(page.clearChatDrafts).toHaveBeenCalledTimes(1)
  expect(page.navigate).toHaveBeenCalledWith('/login')
})

it('keeps local session state and reports when logout cannot destroy the Odoo session', async () => {
  const page = await renderLogout(vi.fn().mockRejectedValue(new Error('logout_failed')))
  await page.click()
  expect(page.clearAiSessionState).not.toHaveBeenCalled()
  expect(page.clear).not.toHaveBeenCalled()
  expect(page.navigate).not.toHaveBeenCalled()
  expect(page.addToast).toHaveBeenCalledWith({ title: 'account.logoutFailed', color: 'error' })
})
