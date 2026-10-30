import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, hostRenderer, type HostNode } from '@liwan/ui/test/helpers/hostRenderer'

const mounted: Vue.App[] = []
afterEach(() => mounted.splice(0).forEach(app => app.unmount()))
const settle = async () => { await Vue.nextTick(); await Vue.nextTick() }
const textOf = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(textOf).join('')
const snapshot = (name: string) => ({ mode: 'inherited', version: 1, user_id: 9, roles: [], branches: [{ id: 2, name, inherit: true, role_ids: [3] }] })
function mountPage(delegation: boolean) {
  const me = Vue.ref<{ id: number; company: { id: number } } | null>({ id: 7, company: { id: 1 } })
  const data = Vue.ref<ReturnType<typeof snapshot> | undefined>(snapshot('A private branch'))
  const query = { data, error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn() }
  const created = vi.fn()
  // The card owns the draft; the page must give it a new instance whenever the identity or the account changes.
  const card = Vue.defineComponent({
    props: ['policy', 'access', 'reloadPolicy', 'reloadAccess', 'userId'],
    setup(props) {
      created()
      return () => Vue.h('div', (props.policy ?? props.access).branches.map((row: { name: string }) => row.name).join(','))
    },
  })
  const box = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', Object.values(slots).flatMap(slot => slot?.() ?? [])) })
  const component = loadShared(resolve(import.meta.dirname, delegation ? '../settings/team/users/[userId]/branches.vue' : '../settings/team/branches.vue'), {
    globals: { useMe: () => ({ me }), useRoute: () => ({ params: { userId: '9' } }), useAccess: () => ({ can: () => true }) },
    modules: {
      '@/components/access/branches/BranchPolicyCard.vue': { __esModule: true, default: card },
      '@/components/access/branches/BranchPresetCard.vue': { __esModule: true, default: Vue.defineComponent({ render: () => null }) },
      '@/components/access/branches/UserBranchAccessCard.vue': { __esModule: true, default: card },
      '@/composables/useApi': { ApiError: class extends Error {} },
      '@/composables/useCreateBranch': { useCreateBranch: () => ({ isPending: { value: false }, mutateAsync: async () => ({}) }) },
      '@/composables/useBranchAccess': { useBranchPolicy: () => query, useUserBranchAccess: () => query },
    },
  })
  const root = createHostNode()
  const app = hostRenderer.createApp(component)
  for (const [name, value] of Object.entries({ ...DEFAULT_STUBS, SharedSettingsPage: box, SharedPageHeader: box, SharedPageState: box, UButton: box })) app.component(name, value)
  app.mount(root); mounted.push(app)
  return { me, data, root, created }
}

describe.each([false, true])('actual branch settings page (delegation=%s)', delegation => {
  it.each(['user', 'company', 'logout'])('drops the card and its draft on %s replacement and shows the narrower new snapshot', async change => {
    const view = mountPage(delegation)
    await settle()
    expect(textOf(view.root)).toContain('A private branch')
    expect(view.created).toHaveBeenCalledTimes(1)
    view.me.value = change === 'logout' ? null : { id: change === 'user' ? 8 : 7, company: { id: change === 'company' ? 2 : 1 } }
    view.data.value = undefined
    await settle()
    expect(textOf(view.root)).not.toContain('A private branch')
    if (change === 'logout') return
    view.data.value = snapshot('B allowed branch')
    await settle()
    expect(textOf(view.root)).toContain('B allowed branch')
    expect(view.created).toHaveBeenCalledTimes(2)
  })
  it('creates a new card when the identity changes while the old snapshot is still cached', async () => {
    const view = mountPage(delegation)
    await settle()
    view.me.value = { id: 8, company: { id: 1 } }
    await settle()
    expect(view.created).toHaveBeenCalledTimes(2)
  })
})
