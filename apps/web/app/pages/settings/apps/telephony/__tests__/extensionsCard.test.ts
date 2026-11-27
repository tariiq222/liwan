import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { TelephonyExtensionListSchema, TelephonyExtensionSchema } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../../composables/useApi'
import { useSettingsForm } from '../../../../../composables/settings/useSettingsForm'

/*
 * The extensions card through its real <script setup> and template, rendered into host nodes: the shared settings card,
 * the fields and the people picker are stand-ins that expose what the card hands them, so a test reads what the reader
 * would. vue-query is replaced by a small fake, so the request the card sends can be read; the card is checked on the
 * contract schema it hands to `$api`, and the fixtures follow the wire as the server sends it (`user` is null for an
 * extension that belongs to nobody).
 */
type HostNode = { type: string; children: HostNode[]; parent: HostNode | null; props: Record<string, any>; text: string }
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
  createElement: type => node(type), createText: text => node('text', text), createComment: () => node('comment', ''),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const all = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(all)]
const text = (root: HostNode): string => root.text + root.children.map(text).join('')
const byTestId = (root: HostNode, id: string) => all(root).find(el => el.props['data-testid'] === id)

const filename = new URL('../../../../../components/telephony/TelephonyExtensionsCard.vue', import.meta.url).pathname
const compiled = ts.transpileModule(compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'telephony-extensions-card', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

/** One extension as the server sends it: `user` is null for an extension that belongs to nobody. */
interface ExtensionWire { id: number; number: string; user: { id: number; name: string } | null; active: boolean }
const LIST = (items: ExtensionWire[]) => ({ items, total: items.length })
const ahmed: ExtensionWire = { id: 1, number: '1001', user: { id: 7, name: 'أحمد' }, active: true }
const nobody: ExtensionWire = { id: 2, number: '1002', user: null, active: true }
const TAKEN = 'هذا الرقم مستخدم مسبقًا'
const LIMIT = 'بلغت الشركة حد التمثيلات'

/** vue-query as the card uses it: the query runs its function into refs, and the client's write lands in the same refs. */
function fakeVueQuery() {
  const entries = new Map<unknown, { data: Vue.Ref<unknown>; error: Vue.Ref<unknown>; isLoading: Vue.Ref<boolean>; run: () => Promise<void> }>()
  const useQuery = (options: { queryKey: unknown; queryFn: (context: { signal: undefined }) => Promise<unknown> }) => {
    const run = async () => {
      const entry = entries.get(options.queryKey)!
      try {
        entry.data.value = await options.queryFn({ signal: undefined })
        entry.error.value = null
      } catch (error) {
        entry.error.value = error
      } finally {
        entry.isLoading.value = false
      }
    }
    const entry = { data: Vue.ref<unknown>(undefined), error: Vue.ref<unknown>(null), isLoading: Vue.ref(true), run }
    entries.set(options.queryKey, entry)
    void run()
    return { ...entry, refetch: async () => { await run(); return { isError: entry.error.value !== null } } }
  }
  const setQueryData = vi.fn((key: unknown, next: unknown) => {
    const entry = entries.get(key)
    if (entry) entry.data.value = typeof next === 'function' ? next(entry.data.value) : next
  })
  return { useQuery, useQueryClient: () => ({ setQueryData }), setQueryData }
}

function loadCard($api: ReturnType<typeof vi.fn>, canEdit: boolean) {
  const query = fakeVueQuery()
  const modules: Record<string, unknown> = {
    'vue': Vue,
    '@tanstack/vue-query': query,
    '@liwan/contracts': { TelephonyExtensionListSchema, TelephonyExtensionSchema },
    '@/composables/useApi': { ApiError },
    '@/composables/settings/useSettingsForm': { useSettingsForm },
  }
  const require = (specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`TelephonyExtensionsCard.vue imports ${specifier}; declare it in modules`)
  }
  const globals = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useApi: () => ({ $api }),
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), compiled)(require, exports, ...Object.values(globals))

  const card = Vue.defineComponent({
    inheritAttrs: false,
    props: ['id', 'title', 'canEdit', 'dirty', 'message', 'onSave'],
    setup(props, { slots }) {
      return () => Vue.h('form', {
        'data-testid': 'card', 'data-id': props.id, 'data-title': props.title,
        'data-dirty': props.dirty === true ? 'true' : 'false', 'data-message': props.message || '',
        'data-can-edit': props.canEdit === true ? 'true' : 'false',
      }, [Vue.h('button', { type: 'button', 'data-testid': 'save', onClick: () => props.onSave?.() }), slots.default?.()])
    },
  })
  const pageState = Vue.defineComponent({
    props: ['loading', 'error'], emits: ['retry'],
    setup(props, { slots }) {
      return () => props.loading ? Vue.h('div', { 'data-testid': 'loading' })
        : props.error ? Vue.h('div', { 'data-testid': 'error' })
          : Vue.h('div', { 'data-testid': 'content' }, slots.default?.())
    },
  })
  const formField = Vue.defineComponent({
    props: ['label', 'help', 'error', 'name'],
    setup(props, { slots }) {
      return () => Vue.h('div', { 'data-testid': `field-${props.name}` }, [
        Vue.h('label', null, props.label), slots.default?.(),
        ...(props.error ? [Vue.h('p', { role: 'alert', 'data-testid': `error-${props.name}` }, props.error)] : []),
      ])
    },
  })
  const input = Vue.defineComponent({
    props: ['modelValue', 'disabled'], emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => Vue.h('input', { value: props.modelValue, disabled: props.disabled, onInput: (event: { value: string }) => emit('update:modelValue', event.value) })
    },
  })
  const picker = Vue.defineComponent({
    props: ['modelValue', 'disabled'], emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => Vue.h('select', { 'data-value': props.modelValue ?? '', disabled: props.disabled, onPick: (value: number | null) => emit('update:modelValue', value) })
    },
  })
  const app = renderer.createApp({ render: () => Vue.h(exports.default!, { id: 'extensions', canEdit }) })
  // A failed setup would otherwise render nothing and fail far from its cause.
  const errors: unknown[] = []
  app.config.errorHandler = (error: unknown) => { errors.push(error) }
  app.component('SharedSettingsCard', card)
  app.component('SharedPageState', pageState)
  app.component('UFormField', formField)
  app.component('UInput', input)
  app.component('SharedPersonPicker', picker)
  const root = node(); app.mount(root)
  return { app, root, errors, setQueryData: query.setQueryData }
}

/** Lets the request, the card's watchers and the render settle; a card that failed on the way says so here. */
const settle = async (screen: { errors: unknown[] }) => {
  for (let round = 0; round < 4; round++) { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
  expect(screen.errors).toEqual([])
}

/** The server the card talks to: the list, and a create that answers the extension it was asked for. */
function server(list: { items: ExtensionWire[]; total: number }) {
  const $api = vi.fn(async (_path: string, options: { method?: string; body?: { number: string; userId: number | null } }) => {
    if (options.method !== 'POST') return list
    const userId = options.body!.userId
    return { id: list.total + 1, number: options.body!.number, user: userId ? { id: userId, name: 'سارة' } : null, active: true } satisfies ExtensionWire
  })
  return $api
}
const posts = ($api: ReturnType<typeof vi.fn>) => $api.mock.calls.filter(call => call[1]?.method === 'POST')
const field = (root: HostNode, id: string) => byTestId(root, id)!
const type = (root: HostNode, value: string) => { field(root, 'telephony-extension-number').props.onInput({ value }) }
const pick = (root: HostNode, userId: number) => { field(root, 'telephony-extension-user').props.onPick(userId) }
const save = async (root: HostNode, screen: { errors: unknown[] }) => { field(root, 'save').props.onClick(); await settle(screen) }

describe('the telephony extensions card', () => {
  beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

  it('reads the list under the contract and renders every extension with its user', async () => {
    const $api = server(LIST([ahmed, nobody]))
    const screen = loadCard($api, true)
    await settle(screen)
    expect($api).toHaveBeenCalledTimes(1)
    expect($api).toHaveBeenCalledWith('/api/v1/telephony/extensions', { schema: TelephonyExtensionListSchema, signal: undefined })
    const card = field(screen.root, 'card')
    expect(card.props['data-id']).toBe('extensions')
    expect(card.props['data-title']).toBe('telephony.settings.extensions')
    expect(card.props['data-can-edit']).toBe('true')
    const shown = text(field(screen.root, 'telephony-extensions'))
    for (const part of ['1001', 'أحمد', '1002', 'telephony.settings.extensionNoUser']) expect(shown, part).toContain(part)
    expect(byTestId(screen.root, 'loading')).toBeUndefined()
    screen.app.unmount()
  })

  it('says so when the company has no extension yet', async () => {
    const screen = loadCard(server(LIST([])), true)
    await settle(screen)
    expect(text(field(screen.root, 'content'))).toContain('telephony.settings.extensionsEmpty')
    expect(byTestId(screen.root, 'telephony-extensions')).toBeUndefined()
    screen.app.unmount()
  })

  it('saves nothing while the row is empty', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    await save(screen.root, screen)
    expect(posts($api)).toEqual([])
    screen.app.unmount()
  })

  it('posts the row as { number, userId }, then shows the server answer in the list and clears the row', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    type(screen.root, ' 1003 ')
    pick(screen.root, 9)
    await Vue.nextTick()
    expect(field(screen.root, 'card').props['data-dirty']).toBe('true')
    await save(screen.root, screen)
    expect(posts($api)).toEqual([['/api/v1/telephony/extensions', { method: 'POST', body: { number: '1003', userId: 9 }, schema: TelephonyExtensionSchema }]])
    expect(screen.setQueryData).toHaveBeenCalledWith(['telephony', 'extensions'], { items: [ahmed, { id: 2, number: '1003', user: { id: 9, name: 'سارة' }, active: true }], total: 2 })
    const shown = text(field(screen.root, 'telephony-extensions'))
    expect(shown).toContain('1003')
    expect(shown).toContain('سارة')
    expect(field(screen.root, 'telephony-extension-number').props.value).toBe('')
    expect(field(screen.root, 'card').props['data-dirty']).toBe('false')
    screen.app.unmount()
  })

  it('sends userId null when the extension gets no user', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    type(screen.root, '1004')
    await save(screen.root, screen)
    expect(posts($api)[0]?.[1].body).toEqual({ number: '1004', userId: null })
    expect(text(field(screen.root, 'telephony-extensions'))).toContain('telephony.settings.extensionNoUser')
    screen.app.unmount()
  })

  it('shows a 422 that names the number under the number and in the card, and keeps what was typed', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    $api.mockRejectedValueOnce(new ApiError(422, 'invalid', TAKEN, 'number'))
    type(screen.root, '1001')
    await save(screen.root, screen)
    expect(posts($api)).toHaveLength(1)
    expect(text(field(screen.root, 'error-extension-number'))).toBe(TAKEN)
    expect(byTestId(screen.root, 'error-extension-user')).toBeUndefined()
    expect(field(screen.root, 'card').props['data-message']).toBe(TAKEN)
    expect(field(screen.root, 'telephony-extension-number').props.value).toBe('1001')
    // The field error is about a value that changed: typing clears it, the card keeps the refusal until the next save.
    type(screen.root, '1005')
    await Vue.nextTick()
    expect(byTestId(screen.root, 'error-extension-number')).toBeUndefined()
    screen.app.unmount()
  })

  it('shows a 422 that names the user under the user', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    $api.mockRejectedValueOnce(new ApiError(422, 'invalid', 'هذا المستخدم غير معروف', 'userId'))
    type(screen.root, '1005')
    pick(screen.root, 99)
    await save(screen.root, screen)
    expect(text(field(screen.root, 'error-extension-user'))).toBe('هذا المستخدم غير معروف')
    expect(byTestId(screen.root, 'error-extension-number')).toBeUndefined()
    screen.app.unmount()
  })

  it('shows a 422 that names no field of the card in the card alone', async () => {
    const $api = server(LIST([ahmed]))
    const screen = loadCard($api, true)
    await settle(screen)
    $api.mockRejectedValueOnce(new ApiError(422, 'invalid', LIMIT, 'limit'))
    type(screen.root, '1005')
    await save(screen.root, screen)
    expect(field(screen.root, 'card').props['data-message']).toBe(LIMIT)
    expect(byTestId(screen.root, 'error-extension-number')).toBeUndefined()
    expect(byTestId(screen.root, 'error-extension-user')).toBeUndefined()
    screen.app.unmount()
  })

  it('keeps a viewer read-only and shows the same list', async () => {
    const screen = loadCard(server(LIST([ahmed])), false)
    await settle(screen)
    expect(field(screen.root, 'card').props['data-can-edit']).toBe('false')
    expect(field(screen.root, 'telephony-extension-number').props.disabled).toBe(true)
    expect(field(screen.root, 'telephony-extension-user').props.disabled).toBe(true)
    expect(text(field(screen.root, 'telephony-extensions'))).toContain('أحمد')
    screen.app.unmount()
  })

  it('offers the retry of a failed list instead of the row', async () => {
    const $api = vi.fn(async () => { throw new ApiError(503, 'unavailable', 'down') })
    const screen = loadCard($api, true)
    await settle(screen)
    expect(byTestId(screen.root, 'error')).toBeTruthy()
    expect(byTestId(screen.root, 'telephony-extension-number')).toBeUndefined()
    screen.app.unmount()
  })
})
