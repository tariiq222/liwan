import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, renderShared } from '@webvue/ui/test/helpers/renderShared'
import { useAiConversation } from '../../composables/useAiConversation'

afterEach(() => vi.unstubAllGlobals())

it('clears the shared assistant conversation on successful logout before identity refresh completes', async () => {
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
  const fetch = vi.fn().mockResolvedValue({})
  const navigate = vi.fn()
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
      $fetch: fetch, refreshNuxtData: vi.fn().mockResolvedValue(undefined), navigateTo: navigate,
    },
    modules: {
      '@/components/account/PasswordForm.vue': { __esModule: true, default: container },
      '@tanstack/vue-query': { useQueryClient: () => ({ cancelQueries, clear }) },
      '@/utils/aiDraft': { clearAiSessionState: vi.fn() },
      '@/composables/useAiConversation': { useAiConversation },
    },
  })
  await click()
  expect(fetch).toHaveBeenCalledWith('/api/auth/logout', { method: 'POST', body: {} })
  expect(conversation.currentRunId.value).toBeNull()
  expect(clear).toHaveBeenCalledTimes(1)
  expect(navigate).toHaveBeenCalledWith('/login')
  scope.stop()
})
