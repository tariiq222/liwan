import { resolve } from 'node:path'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@webvue/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer, type HostNode } from '@webvue/ui/test/helpers/hostRenderer'

const mounted: Vue.App[] = []
afterEach(() => mounted.splice(0).forEach(app => app.unmount()))
const settle = async () => { await Vue.nextTick(); await Vue.nextTick() }
const textOf = (node: HostNode): string => (node.type === 'comment' ? '' : node.text ?? '') + node.children.map(textOf).join('')
const snapshot = (name: string) => ({ mode: 'inherited', version: 1, user_id: 9, roles: [], branches: [{ id: 2, name, inherit: true, role_ids: [3] }] })
function mountPage(delegation: boolean) {
  const me = Vue.ref<{ id: number; company: { id: number } } | null>({ id: 7, company: { id: 1 } })
  const data = Vue.ref<ReturnType<typeof snapshot> | undefined>(snapshot('A private branch'))
  let finish!: (value: ReturnType<typeof snapshot>) => void
  const pending = new Promise<ReturnType<typeof snapshot>>(resolve => { finish = resolve })
  const query = { data, error: Vue.ref(null), isLoading: Vue.ref(false), refetch: vi.fn(async () => ({ data: await pending, error: null })) }
  const mutation = { isPending: Vue.ref(false), mutateAsync: vi.fn(() => pending) }
  let edit!: () => void
  const assignments = Vue.defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup(props, { emit }) {
    edit = () => emit('update:modelValue', props.modelValue.map((row: { role_ids: number[] }) => ({ ...row, role_ids: [] })))
    return () => Vue.h('div', props.modelValue.map((row: { name: string }) => row.name).join(','))
  } })
  const box = Vue.defineComponent({ setup: (_, { slots }) => () => Vue.h('div', Object.values(slots).flatMap(slot => slot?.() ?? [])) })
  const component = loadShared(resolve(import.meta.dirname, delegation ? '../settings/team/users/[userId]/branches.vue' : '../settings/team/branches.vue'), {
    globals: { useMe: () => ({ me }), useRoute: () => ({ params: { userId: '9' } }), useAccess: () => ({ can: () => true }) },
    modules: {
      '@/components/access/branches/BranchRoleAssignments.vue': { __esModule: true, default: assignments },
      '@/composables/useApi': { ApiError: class extends Error {} },
      '@/composables/useBranchAccess': { useBranchPolicy: () => query, useUserBranchAccess: () => query, useUpdateBranchPolicy: () => mutation, useUpdateUserBranchAccess: () => mutation },
    },
  })
  const root = createHostNode()
  const app = hostRenderer.createApp(component)
  for (const [name, value] of Object.entries({ ...DEFAULT_STUBS, SharedSettingsPage: box, SharedPageHeader: box, SharedPageState: box, SharedFormSection: box, SharedFormActions: box, SharedUnsavedChanges: box, UFormField: box, USelect: box })) app.component(name, value)
  app.mount(root); mounted.push(app)
  return { me, data, root, finish, mutation, edit: () => edit() }
}

describe.each([false, true])('actual branch settings page (delegation=%s)', delegation => {
  it.each(['user', 'company', 'logout'])('discards a dirty draft on %s replacement and accepts the narrower new snapshot', async change => {
    const view = mountPage(delegation)
    view.edit(); await settle()
    expect(textOf(view.root)).toContain('A private branch')
    view.me.value = change === 'logout' ? null : { id: change === 'user' ? 8 : 7, company: { id: change === 'company' ? 2 : 1 } }
    await settle()
    expect(textOf(view.root)).not.toContain('A private branch')
    view.data.value = undefined
    if (change !== 'logout') view.data.value = snapshot('B allowed branch')
    await settle()
    if (change !== 'logout') expect(textOf(view.root)).toContain('B allowed branch')
  })
  it.each(['save', 'reload'])('ignores an old %s response after identity changes away and back', async action => {
    const view = mountPage(delegation)
    view.edit(); await settle()
    const submit = () => (findNode(view.root, node => node.type === 'form')!.props.onSubmit as (event: { preventDefault(): void }) => Promise<void>)({ preventDefault() {} })
    if (action === 'save') void submit()
    else {
      view.mutation.mutateAsync.mockRejectedValueOnce(new Error('conflict'))
      await submit(); await settle()
      ;(findNode(view.root, node => node.type === 'button' && node.props.label === 'access.branches.reload')!.props.onClick as () => void)()
      await settle()
      const alert = findNode(view.root, node => Array.isArray(node.props.actions))!
      ;(alert.props.actions as { onClick: () => void }[])[0]!.onClick()
    }
    view.me.value = { id: 8, company: { id: 1 } }; await settle()
    view.me.value = { id: 7, company: { id: 1 } }; await settle()
    view.data.value = snapshot('New authorized snapshot'); await settle()
    view.finish(snapshot('A late private branch')); await settle(); await settle()
    expect(textOf(view.root)).not.toContain('A late private branch')
    expect(textOf(view.root)).toContain('New authorized snapshot')
  })
})
