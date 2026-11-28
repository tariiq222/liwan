import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { TelephonyRecordingSettingsSchema } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../../../composables/useApi'
import { useSettingsForm } from '../../../../../composables/settings/useSettingsForm'

/*
 * The recording card through its real <script setup> and template, rendered into host nodes: the shared settings card,
 * the setting rows, the option cards and the fields are stand-ins that expose what the card hands them, so a test reads
 * what the reader would. vue-query is replaced by a small fake, so the requests the card sends can be read; the GET and
 * the one PATCH body are checked on the contract schema, which is the shape liwan_telephony serializes.
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

const filename = new URL('../../../../../components/telephony/TelephonyRecordingSettingsCard.vue', import.meta.url).pathname
const compiled = ts.transpileModule(compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'telephony-recording-settings-card', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

/** The settings as the server sends them. */
interface SettingsWire { recordingPolicy: 'always' | 'off'; recordingAnnouncement: boolean; recordingRetentionDays: number }
const SAVED: SettingsWire = { recordingPolicy: 'always', recordingAnnouncement: true, recordingRetentionDays: 90 }
const POLICY_TAKEN = 'هذه السياسة غير معروفة'
const FORBIDDEN = 'لا تملك صلاحية إدارة الاتصالات'

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
    '@liwan/contracts': { TelephonyRecordingSettingsSchema },
    '@/composables/settings/useSettingsForm': { useSettingsForm },
  }
  const require = (specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`TelephonyRecordingSettingsCard.vue imports ${specifier}; declare it in modules`)
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
  const row = Vue.defineComponent({
    props: ['label', 'description'],
    setup(props, { slots }) {
      return () => Vue.h('div', { 'data-testid': `row-${props.label}`, 'data-description': props.description }, slots.default?.())
    },
  })
  const optionCards = Vue.defineComponent({
    props: ['modelValue', 'options', 'label', 'disabled'], emits: ['update:modelValue'],
    setup(props, { emit }) {
      return () => Vue.h('div', {
        'data-testid': 'options', 'data-value': props.modelValue ?? '', 'data-options': (props.options as { value: string }[]).map(({ value }) => value).join(','),
        'data-disabled': props.disabled === true ? 'true' : 'false',
        onPick: (value: string) => emit('update:modelValue', value),
      })
    },
  })
  const switchInput = Vue.defineComponent({
    props: ['modelValue', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => Vue.h('div', {
        ...attrs, 'data-value': props.modelValue === true ? 'true' : 'false', 'data-disabled': props.disabled === true ? 'true' : 'false',
        onToggle: (value: boolean) => emit('update:modelValue', value),
      })
    },
  })
  const formField = Vue.defineComponent({
    props: ['label', 'help', 'name'],
    setup(props, { slots }) {
      return () => Vue.h('div', { 'data-testid': `field-${props.name}`, 'data-help': props.help }, [Vue.h('label', null, props.label), slots.default?.()])
    },
  })
  const inputNumber = Vue.defineComponent({
    props: ['modelValue', 'min', 'max', 'disabled'], emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => Vue.h('input', {
        ...attrs, value: props.modelValue, 'data-min': String(props.min), 'data-max': String(props.max),
        disabled: props.disabled, onInput: (value: number) => emit('update:modelValue', value),
      })
    },
  })

  const app = renderer.createApp({ render: () => Vue.h(exports.default!, { id: 'recording', canEdit }) })
  // A failed setup would otherwise render nothing and fail far from its cause.
  const errors: unknown[] = []
  app.config.errorHandler = (error: unknown) => { errors.push(error) }
  app.component('SharedSettingsCard', card)
  app.component('SharedPageState', pageState)
  app.component('SharedSettingRow', row)
  app.component('SharedOptionCards', optionCards)
  app.component('USwitch', switchInput)
  app.component('UFormField', formField)
  app.component('UInputNumber', inputNumber)
  const root = node(); app.mount(root)
  return { app, root, errors, setQueryData: query.setQueryData }
}

/** Lets the request, the card's watchers and the render settle; a card that failed on the way says so here. */
const settle = async (screen: { errors: unknown[] }) => {
  for (let round = 0; round < 4; round++) { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }
  expect(screen.errors).toEqual([])
}

/** The server the card talks to: the settings read, and the one PATCH that answers the saved settings. */
function server(settings: SettingsWire) {
  const $api = vi.fn(async (_path: string, options?: { method?: string; body?: SettingsWire }) => {
    if (options?.method === 'PATCH') return { ...settings, ...options.body }
    return settings
  })
  return $api
}
const patches = ($api: ReturnType<typeof vi.fn>) => $api.mock.calls.filter(call => call[1]?.method === 'PATCH')
const field = (root: HostNode, id: string) => byTestId(root, id)!
const pickPolicy = (root: HostNode, value: SettingsWire['recordingPolicy']) => { field(root, 'telephony-recording-policy').props.onPick(value) }
const toggleAnnouncement = (root: HostNode, value: boolean) => { field(root, 'telephony-recording-announcement').props.onToggle(value) }
const setRetention = (root: HostNode, value: number) => { field(root, 'telephony-recording-retention-days').props.onInput(value) }
const save = async (root: HostNode, screen: { errors: unknown[] }) => { field(root, 'save').props.onClick(); await settle(screen) }

describe('the telephony recording settings card', () => {
  beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => key })) })

  it('reads the settings under the contract and renders the three saved values', async () => {
    const $api = server(SAVED)
    const screen = loadCard($api, true)
    await settle(screen)
    expect($api).toHaveBeenCalledTimes(1)
    expect($api).toHaveBeenCalledWith('/api/v1/telephony/settings', { schema: TelephonyRecordingSettingsSchema, signal: undefined })
    const card = field(screen.root, 'card')
    expect(card.props['data-id']).toBe('recording')
    expect(card.props['data-title']).toBe('telephony.settings.recording')
    expect(card.props['data-can-edit']).toBe('true')
    expect(field(screen.root, 'telephony-recording-policy').props['data-value']).toBe('always')
    expect(field(screen.root, 'telephony-recording-policy').props['data-options']).toBe('always,off')
    expect(field(screen.root, 'telephony-recording-announcement').props['data-value']).toBe('true')
    expect(field(screen.root, 'telephony-recording-retention-days').props.value).toBe(90)
    expect(byTestId(screen.root, 'loading')).toBeUndefined()
    screen.app.unmount()
  })

  it('keeps the retention field inside the contract bounds', async () => {
    const screen = loadCard(server(SAVED), true)
    await settle(screen)
    const input = field(screen.root, 'telephony-recording-retention-days')
    expect(input.props['data-min']).toBe('1')
    expect(input.props['data-max']).toBe('3650')
    screen.app.unmount()
  })

  it('saves nothing while the draft matches the saved settings', async () => {
    const $api = server(SAVED)
    const screen = loadCard($api, true)
    await settle(screen)
    await save(screen.root, screen)
    expect(patches($api)).toEqual([])
    screen.app.unmount()
  })

  it('sends the three fields in one PATCH, validated by the contract, and shows the answer', async () => {
    const $api = server(SAVED)
    const screen = loadCard($api, true)
    await settle(screen)
    pickPolicy(screen.root, 'off')
    toggleAnnouncement(screen.root, false)
    setRetention(screen.root, 30)
    await Vue.nextTick()
    expect(field(screen.root, 'card').props['data-dirty']).toBe('true')
    await save(screen.root, screen)
    const [request] = patches($api)
    expect(request?.[0]).toBe('/api/v1/telephony/settings')
    expect(TelephonyRecordingSettingsSchema.parse(request?.[1].body)).toEqual({ recordingPolicy: 'off', recordingAnnouncement: false, recordingRetentionDays: 30 })
    expect(request?.[1].schema).toBe(TelephonyRecordingSettingsSchema)
    expect(screen.setQueryData).toHaveBeenCalledWith(['telephony', 'settings'], { recordingPolicy: 'off', recordingAnnouncement: false, recordingRetentionDays: 30 })
    expect(field(screen.root, 'telephony-recording-policy').props['data-value']).toBe('off')
    expect(field(screen.root, 'card').props['data-dirty']).toBe('false')
    screen.app.unmount()
  })

  it('shows a 422 refusal from the server in the card and keeps the draft', async () => {
    const $api = server(SAVED)
    const screen = loadCard($api, true)
    await settle(screen)
    $api.mockRejectedValueOnce(new ApiError(422, 'invalid', POLICY_TAKEN, 'recordingPolicy'))
    pickPolicy(screen.root, 'off')
    await save(screen.root, screen)
    expect(patches($api)).toHaveLength(1)
    expect(field(screen.root, 'card').props['data-message']).toBe(POLICY_TAKEN)
    expect(field(screen.root, 'telephony-recording-policy').props['data-value']).toBe('off')
    expect(field(screen.root, 'card').props['data-dirty']).toBe('true')
    screen.app.unmount()
  })

  it('shows a 403 refusal from the server in the card', async () => {
    const $api = server(SAVED)
    const screen = loadCard($api, true)
    await settle(screen)
    $api.mockRejectedValueOnce(new ApiError(403, 'forbidden', FORBIDDEN))
    setRetention(screen.root, 400)
    await save(screen.root, screen)
    expect(field(screen.root, 'card').props['data-message']).toBe(FORBIDDEN)
    screen.app.unmount()
  })

  it('keeps a viewer read-only and shows the same settings', async () => {
    const screen = loadCard(server(SAVED), false)
    await settle(screen)
    expect(field(screen.root, 'card').props['data-can-edit']).toBe('false')
    expect(field(screen.root, 'telephony-recording-policy').props['data-disabled']).toBe('true')
    expect(field(screen.root, 'telephony-recording-announcement').props['data-disabled']).toBe('true')
    expect(field(screen.root, 'telephony-recording-retention-days').props.disabled).toBe(true)
    expect(field(screen.root, 'telephony-recording-retention-days').props.value).toBe(90)
    screen.app.unmount()
  })

  it('offers the retry of a failed read instead of the fields', async () => {
    const $api = vi.fn(async () => { throw new ApiError(503, 'unavailable', 'down') })
    const screen = loadCard($api, true)
    await settle(screen)
    expect(byTestId(screen.root, 'error')).toBeTruthy()
    expect(byTestId(screen.root, 'telephony-recording-policy')).toBeUndefined()
    screen.app.unmount()
  })
})
