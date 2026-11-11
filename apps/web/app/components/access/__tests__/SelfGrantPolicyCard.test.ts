import { resolve } from 'node:path'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { createHostNode, findNode, hostRenderer } from '@liwan/ui/test/helpers/hostRenderer'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'

const policy = (self_grant: 'restricted' | 'allowed') => ({ self_grant, version: 'p1' })

// The real card draws the footer; the stub shows what the form hands it and lets a test press «Save».
const card = Vue.defineComponent({
  inheritAttrs: false,
  props: ['id', 'dirty', 'canEdit'],
  emits: ['save'],
  setup(props, { emit, slots }) {
    return () => Vue.h('section', { 'data-card': props.id, 'data-dirty': props.dirty, 'data-can-edit': props.canEdit }, [
      Vue.h('button', { 'data-save': props.id, onClick: () => emit('save') }), slots.default?.(),
    ])
  },
})
const radio = Vue.defineComponent({
  props: ['modelValue', 'options', 'disabled'], emits: ['update:modelValue'],
  setup: (props, { emit }) => () => Vue.h('div', { 'data-selected': props.modelValue, 'data-disabled': props.disabled }, props.options.map((item: { value: string }) =>
    Vue.h('button', { 'data-item': item.value, onClick: () => emit('update:modelValue', item.value) }))),
})
const stubs = { ...DEFAULT_STUBS, SharedSettingsCard: card, SharedOptionCards: radio }
const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
const common = { useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true) }
vi.stubGlobal('useI18n', common.useI18n)

function mount(value: ReturnType<typeof policy>, canEdit: boolean, mutateAsync = vi.fn(async () => policy('allowed'))) {
  const component = loadShared(resolve(import.meta.dirname, '../SelfGrantPolicyCard.vue'), {
    globals: common,
    modules: {
      '@/composables/settings/useSettingsForm': { useSettingsForm },
      '@/composables/useAccessPolicy': { useUpdateAccessPolicy: () => ({ mutateAsync }) },
      '@/utils/accessErrors': { accessSaveError: (error: unknown) => error },
    },
  })
  const app = hostRenderer.createApp({ render: () => Vue.h(component, { policy: value, canEdit, reloadPolicy: async () => value }) })
  for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
  const root = createHostNode(); app.mount(root)
  return {
    app, mutateAsync,
    card: () => findNode(root, n => n.props['data-card'] === 'access-policy')!,
    options: () => findNode(root, n => n.props['data-selected'] !== undefined)!,
    item: (key: string) => findNode(root, n => n.props['data-item'] === key)!,
    save: () => findNode(root, n => n.props['data-save'] === 'access-policy')!,
  }
}

describe('self-grant policy card', () => {
  it('offers both modes with the saved one selected, and is editable for a manager', () => {
    const view = mount(policy('restricted'), true)
    expect(view.options().props['data-selected']).toBe('restricted')
    expect(view.item('allowed')).toBeTruthy()
    expect(view.card().props['data-can-edit']).toBe(true)
    expect(view.options().props['data-disabled']).toBe(false)
    view.app.unmount()
  })
  it('is read-only without the change capabilities', () => {
    const view = mount(policy('restricted'), false)
    expect(view.card().props['data-can-edit']).toBe(false)
    expect(view.options().props['data-disabled']).toBe(true)
    view.app.unmount()
  })
  it('sends the chosen mode with the policy version when saved', async () => {
    const view = mount(policy('restricted'), true)
    ;(view.item('allowed').props.onClick as () => void)(); await settle()
    expect(view.card().props['data-dirty']).toBe(true)
    await (view.save().props.onClick as () => Promise<void>)(); await settle()
    expect(view.mutateAsync).toHaveBeenCalledWith({ expected_version: 'p1', self_grant: 'allowed' })
    view.app.unmount()
  })
})
