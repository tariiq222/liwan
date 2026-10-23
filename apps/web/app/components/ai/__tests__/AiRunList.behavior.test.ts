import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { AI_RUN_TITLE_MAX_CHARS, AiRunPatchSchema, type AiRunSummary } from '@webvue/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { vueBindings } from '../../../../tests/vueBindings'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../composables/useApi'
import { filterRunsByTitle, groupRunsByDate } from '../../../utils/aiRunGroups'

interface HostNode { type: string; children: HostNode[]; parent: HostNode | null; props: Record<string, unknown>; text: string }
const node = (type = 'root', text = ''): HostNode => ({ type, text, children: [], parent: null, props: {} })
const renderer = Vue.createRenderer<HostNode, HostNode>({
  patchProp: (el, key, _old, value) => { el.props[key] = value },
  insert(child, parent, anchor) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
  },
  remove(child) {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  },
  createElement: type => node(type), createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (el, text) => { el.text = text },
  setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const nodes = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(nodes)]
const text = (root: HostNode): string => root.text + root.children.map(text).join('')

const filename = resolve(import.meta.dirname, '../AiRunList.vue')
function loadComponent(bindings: Record<string, unknown>): Vue.Component {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, { id: 'ai-run-list-behavior', inlineTemplate: true }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const code = ts.transpileModule(compiled, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const globals = { ...vueBindings, ...Object.fromEntries(Object.entries(vueBindings).map(([key, value]) => [`_${key}`, value])), ...bindings }
  return new Function(...Object.keys(globals), code)(...Object.values(globals)) as Vue.Component
}

const messages: Record<string, string> = {
  'ai.history.emptyArchived': 'لا مؤرشفة', 'ai.history.empty': 'لا محادثات', 'ai.history.untitled': 'بلا عنوان',
  'ai.history.actions.rename': 'تغيير الاسم', 'ai.history.actions.archive': 'أرشفة', 'ai.history.actions.unarchive': 'إلغاء الأرشفة',
  'ai.history.rename.invalid': 'اسم غير صالح', 'ai.history.announce.renamed': 'تم تغيير الاسم', 'ai.history.announce.archived': 'تمت الأرشفة',
  'ai.history.announce.unarchived': 'أُعيدت', 'errors.generic': 'تعذّر', 'ai.history.rename.label': 'اسم المحادثة', 'ai.history.title': 'محادثات أخيرة',
  'ai.history.noMatch': 'لا مطابقة', 'ai.history.groups.older': 'أقدم',
}
const run = (id: string, title: string | null, archived = false): AiRunSummary => ({ run_id: id, title, status: 'done', updated_at: '2026-01-05T08:30:00.000Z', archived })
const ACTIVE = [run('r_1', 'ما مهامي؟'), run('r_2', null)]
const ARCHIVED = [run('r_9', 'قديمة', true)]

const apps: Vue.App[] = []
afterEach(() => { for (const app of apps.splice(0)) app.unmount() })

function mountList(props: { disclosure?: boolean } = {}, hydrated = Vue.ref(true)) {
  const actions = { rename: vi.fn(async (_id: string, _title: string) => {}), setArchived: vi.fn(async (_id: string, _archived: boolean) => {}) }
  const toast = { add: vi.fn() }
  const asked: boolean[] = []
  const focus = vi.fn()
  const select = vi.fn()
  const Component = loadComponent({
    formatDate: () => 'D', formatTime: () => 'T', ApiError, AI_RUN_TITLE_MAX_CHARS, AiRunPatchSchema, filterRunsByTitle, groupRunsByDate,
    useRoute: () => ({ query: {} }), useI18n: () => ({ t: (key: string) => messages[key] ?? key }), useHydrated: () => hydrated,
    useToast: () => toast, useAiRunActions: () => actions,
    useAiRuns: (archived: Vue.Ref<boolean>) => {
      const data = Vue.computed(() => { asked.push(archived.value); const items = archived.value ? ARCHIVED : ACTIVE; return { items, total: items.length } })
      return { data, isLoading: Vue.ref(false), isError: Vue.ref(false), error: Vue.ref(undefined), refetch: () => {} }
    },
  })
  const app = renderer.createApp(Component, props)
  const passthrough = (tag: string) => Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => Vue.h(tag, attrs, slots.default?.()) })
  app.component('NuxtLink', passthrough('a'))
  app.component('AiAvatar', Vue.defineComponent({ setup: () => () => Vue.h('i') }))
  app.component('UButton', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('button', attrs, String(attrs.label ?? '')) }))
  app.component('SharedSegmentedControl', Vue.defineComponent({
    inheritAttrs: false, props: ['items', 'modelValue', 'label'], emits: ['update:modelValue'],
    setup: (props, { emit }) => () => Vue.h('div', { role: 'group', 'aria-label': props.label }, props.items.map((item: { value: string; label: string; testId: string }) =>
      Vue.h('button', { 'data-testid': item.testId, 'aria-pressed': item.value === props.modelValue, onClick: () => emit('update:modelValue', item.value) }, item.label))),
  }))
  app.component('UInput', Vue.defineComponent({
    inheritAttrs: false, props: ['modelValue'],
    setup(props, { attrs, expose }) {
      expose({ inputRef: { focus, select } })
      return () => Vue.h('input', { ...attrs, value: props.modelValue })
    },
  }))
  app.component('SharedRowActions', Vue.defineComponent({
    props: ['actions', 'label'],
    setup: props => () => Vue.h('menu', { 'aria-label': props.label }, props.actions.map((action: { label: string; onSelect: () => void }) => Vue.h('item', { onClick: action.onSelect }, action.label))),
  }))
  app.component('SharedPageState', Vue.defineComponent({
    inheritAttrs: false,
    setup: (_, { attrs, slots }) => () => attrs.empty ? Vue.h('p', { 'data-testid': 'empty' }, String(attrs['empty-text'])) : slots.default?.(),
  }))
  const host = node()
  app.mount(host)
  apps.push(app)
  const find = (testId: string) => nodes(host).find(el => el.props['data-testid'] === testId)
  const control = (testId: string) => { const el = find(testId); if (!el) throw new Error(`Missing ${testId}`); return el }
  const action = (label: string, index = 0) => nodes(host).filter(el => el.type === 'item' && text(el) === label)[index]!
  const flush = async () => { await Vue.nextTick(); await new Promise(resolve => setTimeout(resolve, 0)); await Vue.nextTick() }
  const choose = async (label: string, index = 0) => { (action(label, index).props.onClick as () => void)(); await flush() }
  const type = async (value: string) => { (control('ai-run-rename-input').props['onUpdate:modelValue'] as (v: string) => void)(value); await Vue.nextTick() }
  const key = async (name: 'Escape') => { (control('ai-run-rename-input').props.onKeydown as (e: unknown) => void)({ key: name, preventDefault() {} }); await Vue.nextTick() }
  const blur = async () => { (control('ai-run-rename-input').props.onBlur as () => void)(); await flush() }
  const submit = async () => { (control('ai-run-rename').props.onSubmit as (e: unknown) => void)({ preventDefault() {} }); await flush() }
  const titles = () => nodes(host).filter(el => el.props['data-testid'] === 'ai-run-item').map(text)
  return { host, actions, toast, asked, focus, select, find, control, action, choose, type, key, blur, submit, flush, titles }
}

describe('AiRunList actions', () => {
  it('disables search until hydration and enables it when hydration completes', async () => {
    const hydrated = Vue.ref(false)
    const list = mountList({}, hydrated)
    expect(list.control('ai-run-search').props.disabled).toBe(true)
    hydrated.value = true
    await Vue.nextTick()
    expect(list.control('ai-run-search').props.disabled).toBe(false)
  })

  it('filters the loaded conversations live by title and says so when nothing matches', async () => {
    const list = mountList()
    const search = list.control('ai-run-search')
    ;(search.props['onUpdate:modelValue'] as (v: string) => void)('مهامي')
    await Vue.nextTick()
    expect(list.titles()).toHaveLength(1)
    expect(text(list.host)).toContain('ما مهامي؟')
    ;(search.props['onUpdate:modelValue'] as (v: string) => void)('لا يوجد')
    await Vue.nextTick()
    expect(list.titles()).toHaveLength(0)
    expect(text(list.host)).toContain('لا مطابقة')
  })

  it('groups the rows under date headings', () => {
    const list = mountList()
    expect(text(list.host)).toContain('أقدم')
  })

  it('shows the active conversations first and the archived ones after the toggle, with the matching empty text', async () => {
    const list = mountList()
    expect(list.titles()).toHaveLength(2)
    expect(text(list.host)).toContain('ما مهامي؟')
    expect(text(list.host)).not.toContain('قديمة')
    expect(list.control('ai-view-active').props['aria-pressed']).toBe(true)
    expect(list.control('ai-view-archived').props['aria-pressed']).toBe(false)
    ;(list.control('ai-view-archived').props.onClick as () => void)()
    await Vue.nextTick()
    expect(list.titles()).toHaveLength(1)
    expect(text(list.host)).toContain('قديمة')
    expect(list.control('ai-view-archived').props['aria-pressed']).toBe(true)
    expect(list.action('إلغاء الأرشفة')).toBeTruthy()
    expect(list.action('أرشفة', 0)).toBeUndefined()
    expect(list.asked).toContain(true)
  })

  it('renames in place: Enter saves the trimmed name, the editor closes and the change is announced', async () => {
    const list = mountList()
    await list.choose('تغيير الاسم')
    expect(list.control('ai-run-rename-input').props.value).toBe('ما مهامي؟')
    expect(list.control('ai-run-rename-input').props.maxlength).toBe(80)
    expect(list.focus).toHaveBeenCalled()
    expect(list.select).toHaveBeenCalled()
    await list.type('  مشروع البوابة  ')
    await list.submit()
    expect(list.actions.rename).toHaveBeenCalledExactlyOnceWith('r_1', 'مشروع البوابة')
    expect(list.find('ai-run-rename')).toBeUndefined()
    expect(text(list.control('ai-run-announcement'))).toBe('تم تغيير الاسم')
  })

  it('saves once when Enter is followed by the blur of the closing editor', async () => {
    const list = mountList()
    await list.choose('تغيير الاسم')
    await list.type('اسم جديد')
    const pending = list.submit()
    await list.blur()
    await pending
    expect(list.actions.rename).toHaveBeenCalledTimes(1)
  })

  it('saves on blur, and closes without a request when the name did not change', async () => {
    const list = mountList()
    await list.choose('تغيير الاسم')
    await list.type('اسم عبر الخروج')
    await list.blur()
    expect(list.actions.rename).toHaveBeenCalledExactlyOnceWith('r_1', 'اسم عبر الخروج')
    await list.choose('تغيير الاسم')
    await list.blur()
    expect(list.find('ai-run-rename')).toBeUndefined()
    expect(list.actions.rename).toHaveBeenCalledTimes(1)
  })

  it('Escape cancels without a request and a blur after it does nothing', async () => {
    const list = mountList()
    await list.choose('تغيير الاسم')
    await list.type('تغيير لا يُحفظ')
    const input = list.control('ai-run-rename-input')
    await list.key('Escape')
    expect(list.find('ai-run-rename')).toBeUndefined()
    ;(input.props.onBlur as () => void)()
    await list.flush()
    expect(list.actions.rename).not.toHaveBeenCalled()
  })

  it('keeps the editor open with the reason beside it when the name is invalid or the server refuses', async () => {
    const list = mountList()
    await list.choose('تغيير الاسم')
    await list.type('سطر\nثان')
    await list.submit()
    expect(list.actions.rename).not.toHaveBeenCalled()
    expect(list.control('ai-run-rename-input').props['aria-invalid']).toBe(true)
    expect(list.control('ai-run-rename-error').props.role).toBe('alert')
    expect(text(list.control('ai-run-rename-error'))).toBe('اسم غير صالح')
    await list.type('   ')
    await list.blur()
    expect(list.actions.rename).not.toHaveBeenCalled()
    expect(list.find('ai-run-rename')).toBeDefined()
    list.actions.rename.mockRejectedValueOnce(new ApiError(422, 'invalid', 'الاسم مرفوض'))
    await list.type('اسم')
    await list.submit()
    expect(text(list.control('ai-run-rename-error'))).toBe('الاسم مرفوض')
    expect(list.control('ai-run-rename-input').props.value).toBe('اسم')
    list.actions.rename.mockRejectedValueOnce(new Error('network'))
    await list.submit()
    expect(text(list.control('ai-run-rename-error'))).toBe('تعذّر')
    await list.submit()
    expect(list.find('ai-run-rename')).toBeUndefined()
    expect(list.actions.rename).toHaveBeenLastCalledWith('r_1', 'اسم')
  })

  it('archives at once without a confirmation and announces it', async () => {
    const list = mountList()
    await list.choose('أرشفة', 1)
    expect(list.actions.setArchived).toHaveBeenCalledExactlyOnceWith('r_2', true)
    expect(text(list.control('ai-run-announcement'))).toBe('تمت الأرشفة')
    expect(list.toast.add).not.toHaveBeenCalled()
  })

  it('unarchives from the archived view', async () => {
    const list = mountList()
    ;(list.control('ai-view-archived').props.onClick as () => void)()
    await Vue.nextTick()
    await list.choose('إلغاء الأرشفة')
    expect(list.actions.setArchived).toHaveBeenCalledExactlyOnceWith('r_9', false)
    expect(text(list.control('ai-run-announcement'))).toBe('أُعيدت')
  })

  it('reports a refused archive with the server message and announces nothing', async () => {
    const list = mountList()
    list.actions.setArchived.mockRejectedValueOnce(new ApiError(404, 'not_found', 'غير موجودة'))
    await list.choose('أرشفة')
    expect(list.toast.add).toHaveBeenCalledWith({ title: 'غير موجودة', color: 'error' })
    expect(text(list.control('ai-run-announcement'))).toBe('')
    list.actions.setArchived.mockRejectedValueOnce(new Error('network'))
    await list.choose('أرشفة')
    expect(list.toast.add).toHaveBeenLastCalledWith({ title: 'تعذّر', color: 'error' })
  })
})

describe('AiRunList as a mobile disclosure', () => {
  it('starts closed with only the toggle, and opens and closes the list inline', async () => {
    const list = mountList({ disclosure: true })
    const toggle = list.control('ai-history-toggle')
    expect(toggle.props['aria-expanded']).toBe(false)
    expect(list.find('ai-run-list-body')).toBeUndefined()
    expect(list.titles()).toHaveLength(0)
    ;(toggle.props.onClick as () => void)()
    await Vue.nextTick()
    expect(list.control('ai-history-toggle').props['aria-expanded']).toBe(true)
    expect(list.control('ai-history-toggle').props['aria-controls']).toBe(list.control('ai-run-list-body').props.id)
    expect(list.titles()).toHaveLength(2)
    ;(list.control('ai-history-toggle').props.onClick as () => void)()
    await Vue.nextTick()
    expect(list.find('ai-run-list-body')).toBeUndefined()
  })

  it('closes when a conversation link is chosen, but not for clicks on other controls', async () => {
    const list = mountList({ disclosure: true })
    const open = async () => { ;(list.control('ai-history-toggle').props.onClick as () => void)(); await Vue.nextTick() }
    const clickOn = async (target: HostNode) => {
      const closest = (selector: string) => (selector === 'a' && target.type === 'a' ? target : null)
      ;(list.control('ai-run-list-body').props.onClick as (e: unknown) => void)({ target: { closest } })
      await Vue.nextTick()
    }
    await open()
    await clickOn(nodes(list.host).find(el => el.props['data-testid'] === 'ai-view-archived')!)
    expect(list.find('ai-run-list-body')).toBeDefined()
    await clickOn(nodes(list.host).find(el => el.props['data-testid'] === 'ai-run-item')!)
    expect(list.find('ai-run-list-body')).toBeUndefined()
  })

  it('has no toggle and always shows the list when it is the desktop sidebar panel', () => {
    const list = mountList()
    expect(list.find('ai-history-toggle')).toBeUndefined()
    expect(list.titles()).toHaveLength(2)
  })
})
