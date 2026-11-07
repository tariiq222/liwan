import { afterEach, expect, it, vi } from 'vitest'
import { computed, createSSRApp, effectScope, ref, toValue, type EffectScope } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { useMarkChatRead } from '../useChat'
const scopes: EffectScope[] = [], clients: QueryClient[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
function mount() {
  const me = ref({ id: 1, company: { id: 2 } }), conversation = ref(1)
  const api = vi.fn(async () => ({ id: 1 }))
  vi.stubGlobal('computed', computed); vi.stubGlobal('toValue', toValue)
  vi.stubGlobal('useMe', () => ({ me })); vi.stubGlobal('useApi', () => ({ $api: api })); vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  const qc = new QueryClient(), scope = effectScope(), app = createSSRApp({ render: () => null })
  clients.push(qc); scopes.push(scope); app.use(VueQueryPlugin, { queryClient: qc })
  const mutation = app.runWithContext(() => scope.run(() => useMarkChatRead(() => conversation.value))!)
  return { me, conversation, api, mutation }
}
it('captures the conversation before native mutation scheduling can observe navigation', async () => {
  const view = mount()
  const request = view.mutation.mutateAsync(10)
  view.conversation.value = 2
  await request
  expect(view.api).toHaveBeenCalledWith('/api/v1/chat/conversations/1/read', expect.objectContaining({ body: { message_id: 10 } }))
})
it('refuses a captured read when identity changes before native mutation dispatch', async () => {
  const view = mount()
  const request = view.mutation.mutateAsync(10)
  view.me.value = { id: 3, company: { id: 4 } }
  await expect(request).rejects.toMatchObject({ code: 'identity_changed' })
  expect(view.api).not.toHaveBeenCalled()
})
it('keeps scalar variables in the public mutation refs and callbacks', async () => {
  const view = mount(), onSuccess = vi.fn()
  await view.mutation.mutateAsync(10, { onSuccess })
  expect(view.mutation.variables.value).toBe(10)
  expect(onSuccess.mock.calls[0]?.[1]).toBe(10)
})
