import { resolve } from 'node:path'
import { QueryClient } from '@tanstack/query-core'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUBS, fakeT, loadShared } from '@liwan/ui/test/helpers/renderShared'
import { invalidateProjectSettingsCaches, projectSettingsKeys } from '../../../composables/useProjectSettings'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { saveErrorMessage } from '../../../utils/formFeedback'

const filename = resolve(import.meta.dirname, '../ProjectSettingsForm.vue')

type Node = { type: string; props: Record<string, any>; children: Node[]; parent: Node | null; text?: string }
const node = (type = 'root'): Node => ({ type, props: {}, children: [], parent: null })
const renderer = Vue.createRenderer<Node, Node>({
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(el, parent) { el.parent = parent; parent.children.push(el) },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1) },
  createElement: node, createText: text => ({ ...node('text'), text }), createComment: text => ({ ...node('comment'), text }),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})

const passthrough = Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs, slots }) { return () => Vue.h('div', attrs, slots.default?.()) } })
// The real card draws a form and footer; the stub shows what the form hands it and lets a test press «Save changes».
const card = Vue.defineComponent({
  inheritAttrs: false,
  props: ['id', 'dirty', 'canEdit', 'title', 'description'],
  emits: ['save'],
  setup(props, { emit, slots }) {
    return () => Vue.h('section', { 'data-card': props.id, 'data-dirty': props.dirty, 'data-can-edit': props.canEdit }, [
      Vue.h('p', props.description), Vue.h('button', { 'data-save': props.id, onClick: () => emit('save') }), slots.default?.(),
    ])
  },
})
const guard = Vue.defineComponent({ props: ['dirty'], setup: props => () => Vue.h('i', { 'data-guard': props.dirty }) })
const stubs = {
  ...DEFAULT_STUBS,
  SharedUnsavedChanges: guard,
  ...Object.fromEntries(['UFormField', 'URadioGroup', 'USwitch', 'UInputNumber', 'SharedRecordSection', 'StageListEditor'].map(name => [name, passthrough])),
  SharedSettingsCard: card,
}

const settings = (extensions: unknown[] = []) => ({
  project_creators: 'managers', default_stages: [{ name: 'A', fold: false }], require_manager_on_create: true,
  require_end_date_on_create: true, default_completion_approval: 'none', deadline_reminders_enabled: true,
  deadline_reminders_days_before: 1, overdue_digest_enabled: true, require_charter_approval: false, close_with_open_tasks: 'block', register_status_transitions: 'sequence', extensions,
})

const toastAdd = vi.fn()
function load(updateSettings = vi.fn(async (patch: object) => ({ ...settings(), ...patch }))) {
  const hydrated = Vue.ref(true)
  return {
    updateSettings,
    component: loadShared(filename, {
      messages: {},
      modules: {
        '@/components/pmo/projects/StageListEditor.vue': { __esModule: true, default: passthrough },
        '@/composables/settings/useSettingsForm': { useSettingsForm },
        '@/composables/useApi': { ApiError },
        '@/utils/formFeedback': { saveErrorMessage },
        '@/composables/useProjectSettings': {
          useProjectSettings: () => ({ refetch: async () => ({ data: settings() }) }),
          useUpdateProjectSettings: () => ({ mutateAsync: updateSettings, isPending: Vue.ref(false) }),
        },
      },
      globals: { useHydrated: () => hydrated, useToast: () => ({ add: toastAdd }) },
    }),
  }
}

async function render(props: { settings: ReturnType<typeof settings>; canEdit: boolean }) {
  const app = Vue.createSSRApp({ render: () => Vue.h(load().component, props) })
  app.config.globalProperties.$t = fakeT() as never
  for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
  return renderToString(app)
}

beforeEach(() => { toastAdd.mockClear(); vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

describe('ProjectSettingsForm production template', () => {
  it('replaces the saved settings and makes create defaults ask the server again', async () => {
    const queryClient = new QueryClient()
    await queryClient.prefetchQuery({ queryKey: projectSettingsKeys.all, queryFn: async () => ({ project_creators: 'managers' }) })
    await queryClient.prefetchQuery({ queryKey: projectSettingsKeys.createDefaults, queryFn: async () => ({ require_manager_on_create: false }) })

    invalidateProjectSettingsCaches(queryClient, { project_creators: 'employees' } as never)

    // The server answered with the settings, so they are authoritative.
    expect(queryClient.getQueryData(projectSettingsKeys.all)).toEqual({ project_creators: 'employees' })
    // The defaults are derived from them by the server, so a local guess would
    // be wrong: /projects/new has to ask again.
    expect(queryClient.getQueryState(projectSettingsKeys.createDefaults)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryData(projectSettingsKeys.createDefaults), 'the stale answer stays visible until the refetch lands')
      .toEqual({ require_manager_on_create: false })
    queryClient.clear()
  })

  it('renders one settings card per group, each under its anchor id', async () => {
    const html = await render({ settings: settings(), canEdit: true })
    for (const id of ['project-creation', 'project-approval', 'project-reminders']) expect(html).toContain(`data-card="${id}"`)
    expect(html).toContain('settings.projects.createRequirements.manager')
    expect(html).toContain('settings.projects.approval.hint')
    expect(html).toContain('settings.projects.reminders.digest')
    expect(html).not.toContain('data-card="project-extensions"')
  })

  it('hands a view-only manager the same cards without edit rights', async () => {
    const html = await render({ settings: settings(), canEdit: false })
    expect(html).toContain('data-can-edit="false"')
    expect(html).not.toContain('data-can-edit="true"')
  })

  it('renders the settings other applications add, each with the server label and help', async () => {
    const html = await render({
      settings: settings([
        { name: 'mode', kind: 'selection', label: 'Cost center mode', help: 'Auto creates one per project', value: 'auto', options: [{ value: 'auto', label: 'Automatic' }] },
        { name: 'flag', kind: 'boolean', label: 'A switch', help: null, value: true },
      ]),
      canEdit: true,
    })
    expect(html).toContain('data-card="project-extensions"')
    expect(html).toContain('Cost center mode')
    expect(html).toContain('Auto creates one per project')
    expect(html).toContain('settings-extension-mode')
    expect(html).toContain('A switch')
    expect(html).toContain('settings-extension-flag')
  })

  function mount(updateSettings = vi.fn(async (patch: object) => ({ ...settings(), ...patch }))) {
    const { component } = load(updateSettings)
    const app = renderer.createApp({ render: () => Vue.h(component, { settings: settings(), canEdit: true }) })
    for (const [name, stub] of Object.entries(stubs)) app.component(name, stub)
    const root = node(); app.mount(root)
    const find = (match: (el: Node) => boolean, el: Node = root): Node | undefined => match(el) ? el : el.children.map(child => find(match, child)).find(Boolean)
    return { app, updateSettings, find, byId: (id: string) => find(el => el.props.id === id)!, save: (card: string) => find(el => el.props['data-save'] === card)!.props.onClick() }
  }
  const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }

  it('saves only the fields its card changed and confirms with a toast', async () => {
    const h = mount()
    h.byId('settings-require-manager').props['onUpdate:modelValue'](false)
    await Vue.nextTick()
    expect(h.find(el => el.props['data-card'] === 'project-creation')!.props['data-dirty']).toBe(true)
    expect(h.find(el => el.props['data-card'] === 'project-reminders')!.props['data-dirty']).toBe(false)
    h.save('project-creation'); await settle()
    expect(h.updateSettings).toHaveBeenCalledWith({ require_manager_on_create: false })
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ title: 'settings.projects.saved', color: 'success' }))
    h.app.unmount()
  })

  it('refuses an emptied or out-of-range reminder day count without sending it', async () => {
    const h = mount()
    for (const value of [undefined, 31, 1.5]) {
      h.byId('reminder-days').props['onUpdate:modelValue'](value); await Vue.nextTick()
      h.save('project-reminders'); await settle()
      expect(h.updateSettings).not.toHaveBeenCalled()
      expect(h.find(el => el.props.error === 'settings.projects.reminders.daysInvalid')).toBeDefined()
    }
    h.byId('reminder-days').props['onUpdate:modelValue'](5); await Vue.nextTick()
    expect(h.find(el => el.props.error === 'settings.projects.reminders.daysInvalid')).toBeUndefined()
    h.save('project-reminders'); await settle()
    expect(h.updateSettings).toHaveBeenCalledWith({ deadline_reminders_days_before: 5 })
    h.app.unmount()
  })

  it('keeps the leave guard on while a failed stage save waits for a retry', async () => {
    const h = mount(vi.fn(async () => { throw new ApiError(500, 'internal', 'down') }))
    const guardState = () => h.find(el => 'data-guard' in el.props)!.props['data-guard']
    expect(guardState()).toBe(false)
    h.find(el => typeof el.props.onAdd === 'function')!.props.onAdd('New stage'); await settle()
    expect(h.find(el => el.props['data-testid'] === 'stage-save-feedback')).toBeDefined()
    expect(guardState()).toBe(true)
    h.app.unmount()
  })
})
