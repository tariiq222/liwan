import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxFlow } from '@webvue/contracts'
import { TEMPLATE_LANGUAGES } from '../../../composables/inbox/inboxTemplate'
import * as inboxFlow from '../../../composables/inbox/inboxFlow'
import { mountScript } from './scriptHarness'

const url = (name: string) => new URL(`../${name}.vue`, import.meta.url)
const FLOW: InboxFlow = {
  id: 5, channel: { id: 2, name: 'القناة' }, name: 'طلب', category: 'lead_generation', language: 'ar', status: 'draft', health: 'unknown', provider_flow_id: '99', json_version: null,
  supported: true, editable: true, sendable: false, error_count: 0, submission_count: 0, version_warning: null, published_at: null, updated_at: '2026-10-29T08:00:00Z',
  completion_message: null, replaces: null, validation_errors: [],
  screens: [{ id: 1, key: 'SCREEN_A', title: 'بياناتك', footer_label: 'إرسال', fields: [{ id: 1, kind: 'text_input', key: 'name', label: 'الاسم', required: true, sensitive: false, input_type: 'text', helper_text: null, min_chars: null, max_chars: null }] }],
}
// The texts of the starters have limits (a label holds 20 characters), so a key stands for its text by its last part.
const shortText = (key: string) => key.split('.').at(-1)!
const mutation = (impl: (input: unknown) => Promise<unknown>) => ({ mutateAsync: vi.fn(impl), mutate: vi.fn(), isPending: Vue.ref(false) })

describe('InboxFlowBuilder', () => {
  function mountBuilder(props: Record<string, unknown> = {}, save = mutation(async () => FLOW)) {
    const mounted = mountScript(url('InboxFlowBuilder'), { ...inboxFlow, InboxFlowPreview: {}, InboxFlowScreenEditor: {}, useSaveInboxFlow: () => save }, { flow: FLOW, backTo: '/back', ...props })
    return { ...mounted, save }
  }

  it('starts clean and dirty once something changes', () => {
    const { state } = mountBuilder()
    expect(state.dirty).toBe(false)
    state.draft.name = 'اسم آخر'
    expect(state.dirty).toBe(true)
  })

  it('sends nothing, and shows the problem on its field, while the draft breaks a limit', async () => {
    const { state, save } = mountBuilder()
    state.draft.screens[0].fields[0].label = 'x'.repeat(21)
    expect(state.problems).toEqual([])
    await state.submit()
    expect(save.mutateAsync).not.toHaveBeenCalled()
    expect(state.problems).toEqual([{ screen: 0, field: 0, prop: 'label', code: 'invalid' }])
  })

  it('replaces the draft by id, emits the stored form and is clean again', async () => {
    const stored = { ...FLOW, name: 'جديد' }
    const { state, save, emitted } = mountBuilder({}, mutation(async () => stored))
    state.draft.name = 'جديد'
    await state.submit()
    expect(save.mutateAsync).toHaveBeenCalledWith({ id: 5, body: expect.objectContaining({ name: 'جديد', category: 'lead_generation', completion_message: null }) })
    expect(emitted).toEqual([['saved', stored]])
    expect(state.dirty).toBe(false)
  })

  it('shows the server\'s refusal, and a Meta outage in its own words', async () => {
    const refusal = Object.assign(new Error('الاسم مكرر'), { field: 'name', status: 422 })
    const first = mountBuilder({}, mutation(async () => { throw refusal }))
    first.state.draft.name = 'مكرر'
    await first.state.submit()
    expect(first.state.serverError).toMatchObject({ field: 'name', message: 'الاسم مكرر' })
    const outage = mountBuilder({}, mutation(async () => { throw Object.assign(new Error('bad gateway'), { status: 502 }) }))
    outage.state.draft.name = 'x'
    await outage.state.submit()
    expect(outage.state.serverError).toMatchObject({ status: 502, message: 'inbox.flows.metaUnreachable' })
  })

  it('does not save a read-only form and is never dirty', async () => {
    const { state, save } = mountBuilder({ readonly: true })
    state.draft.name = 'x'
    expect(state.dirty).toBe(false)
    await state.submit()
    expect(save.mutateAsync).not.toHaveBeenCalled()
  })

  it('adds, moves and removes screens within the limit and keeps the last one', () => {
    const { state } = mountBuilder()
    state.addScreen()
    expect(state.draft.screens).toHaveLength(2)
    expect(state.draft.screens[1].footerLabel).toBe('inbox.flows.defaults.submit')
    expect(state.activeScreen).toBe(1)
    state.moveScreen(1, -1)
    expect(state.activeScreen).toBe(0)
    expect(state.draft.screens[0].title).toBe('')
    state.removeScreen(0)
    state.removeScreen(0)
    expect(state.draft.screens).toHaveLength(1)
    for (let n = 0; n < 12; n++) state.addScreen()
    expect(state.draft.screens).toHaveLength(inboxFlow.FLOW_LIMITS.screens)
  })

  it('puts Meta\'s errors on the field they point at and the rest in the alert', () => {
    const errors = [{ message: 'bad label', path: '$.screens[0].layout.children[0].label', line: null, column: null }, { message: 'bad json', path: null, line: null, column: null }]
    const { state } = mountBuilder({ flow: { ...FLOW, validation_errors: errors, error_count: 2 } })
    expect(state.meta.placed).toEqual([{ error: errors[0], spot: { screen: 0, field: 0 } }])
    expect(state.meta.loose).toEqual([errors[1]])
  })
})

describe('InboxFlowCreateForm', () => {
  function mountCreate(save = mutation(async () => FLOW)) {
    const mounted = mountScript(url('InboxFlowCreateForm'), { ...inboxFlow, TEMPLATE_LANGUAGES, useSaveInboxFlow: () => save, useI18n: () => ({ t: shortText, locale: Vue.ref('ar') }) }, { channelId: 2, backTo: '/back' })
    return { ...mounted, save }
  }

  it('creates a blank draft from the name, category and language', async () => {
    const { state, save, emitted } = mountCreate()
    await state.submit()
    expect(save.mutateAsync).not.toHaveBeenCalled()
    state.name = 'استبيان'
    state.category = 'survey'
    state.language = 'en'
    await state.submit()
    expect(save.mutateAsync).toHaveBeenCalledWith({ body: expect.objectContaining({ name: 'استبيان', category: 'survey', language: 'en', screens: [expect.objectContaining({ title: 'screenTitle' })] }) })
    expect(emitted).toEqual([['saved', FLOW]])
  })

  it('takes a sector starter\'s name and category and sends its screens', async () => {
    const { state, save } = mountCreate()
    state.start = 'clinic'
    await Vue.nextTick()
    expect(state.name).toBe('name')
    expect(state.category).toBe('appointment_booking')
    state.name = 'حجز العيادة'
    await state.submit()
    const body = save.mutateAsync.mock.calls[0]![0] as { body: { screens: unknown[]; category: string } }
    expect(body.body.screens).toHaveLength(2)
    expect(body.body.category).toBe('appointment_booking')
  })

  it('shows a refusal on the name field and a Meta outage in its own words', async () => {
    const { state } = mountCreate(mutation(async () => { throw Object.assign(new Error('الاسم مكرر'), { field: 'name' }) }))
    state.name = 'x'
    await state.submit()
    expect(state.serverError).toEqual({ field: 'name', message: 'الاسم مكرر' })
    const outage = mountCreate(mutation(async () => { throw Object.assign(new Error('x'), { status: 502 }) }))
    outage.state.name = 'x'
    await outage.state.submit()
    expect(outage.state.serverError?.message).toBe('metaUnreachable')
  })
})

describe('InboxFlowLifecycle', () => {
  function mountLifecycle(flow: Partial<InboxFlow> = {}, extra: Record<string, unknown> = {}) {
    const publish = { mutate: vi.fn((_id: number, options: { onSuccess: () => void }) => options.onSuccess()), isPending: Vue.ref(false) }
    const copy = { mutate: vi.fn((_input: unknown, options: { onSuccess: (flow: InboxFlow) => void }) => options.onSuccess({ ...FLOW, id: 6 })), isPending: Vue.ref(false) }
    const bindings = {
      ...inboxFlow, flowResponsesRoute: inboxFlow.flowResponsesRoute,
      useInboxFlowPreviewLink: () => ({ mutate: vi.fn(), isPending: Vue.ref(false) }), usePublishInboxFlow: () => publish, useDeprecateInboxFlow: () => ({ mutate: vi.fn(), isPending: Vue.ref(false) }),
      useCopyInboxFlow: () => copy, useDeleteInboxFlow: () => ({ mutate: vi.fn(), isPending: Vue.ref(false) }),
    }
    const mounted = mountScript(url('InboxFlowLifecycle'), bindings, { flow: { ...FLOW, ...flow }, ...extra })
    return { ...mounted, publish, copy }
  }

  it('publishes only a saved draft with no problem from Meta, after the inline confirmation', () => {
    expect(mountLifecycle().state.canPublish).toBe(true)
    expect(mountLifecycle({}, { dirty: true }).state.canPublish).toBe(false)
    expect(mountLifecycle({ error_count: 1 }).state.canPublish).toBe(false)
    expect(mountLifecycle({ status: 'published', editable: false }).state.canPublish).toBe(false)
    const { state, publish } = mountLifecycle()
    state.ask('publish')
    expect(state.step).toBe('publish')
    expect(publish.mutate).not.toHaveBeenCalled()
    state.confirmPublish()
    expect(publish.mutate).toHaveBeenCalledWith(5, expect.anything())
    expect(state.step).toBeNull()
  })

  it('copies a published form with the replace choice on by default, and a draft without it', () => {
    const published = mountLifecycle({ status: 'published', editable: false })
    published.state.ask('copy')
    expect(published.state.replace).toBe(true)
    expect(published.state.copyName).toBe('inbox.flows.lifecycle.copyName {"name":"طلب"}')
    published.state.replace = false
    published.state.confirmCopy()
    expect(published.copy.mutate).toHaveBeenCalledWith({ id: 5, body: { name: published.state.copyName, replace: false } }, expect.anything())
    expect(published.emitted).toEqual([['copied', expect.objectContaining({ id: 6 })]])
    const draft = mountLifecycle()
    draft.state.ask('copy')
    draft.state.confirmCopy()
    expect(draft.copy.mutate).toHaveBeenCalledWith({ id: 5, body: expect.objectContaining({ replace: false }) }, expect.anything())
  })

  it('does not copy with a blank name', () => {
    const { state, copy } = mountLifecycle()
    state.ask('copy')
    state.copyName = '  '
    state.confirmCopy()
    expect(copy.mutate).not.toHaveBeenCalled()
  })
})

describe('InboxFlowFieldEditor', () => {
  function mountField(kind: inboxFlow.FlowFieldDraft['kind'], problems: inboxFlow.FlowProblem[] = []) {
    const field = Vue.ref({ ...inboxFlow.emptyField(kind), key: 'k' })
    const mounted = mountScript(url('InboxFlowFieldEditor'), { ...inboxFlow }, { modelValue: field.value, index: 0, count: 3, problems })
    return { ...mounted, field: mounted.props.modelValue as inboxFlow.FlowFieldDraft }
  }

  it('limits a dropdown to 200 choices and a group to 20, and keeps at least one', () => {
    const dropdown = mountField('dropdown')
    expect(dropdown.state.optionMax).toBe(200)
    expect(mountField('checkbox').state.optionMax).toBe(20)
    const radio = mountField('radio')
    for (let n = 0; n < 30; n++) radio.state.addOption()
    expect(radio.field.options).toHaveLength(20)
    for (let n = 0; n < 30; n++) radio.state.removeOption(0)
    expect(radio.field.options).toHaveLength(1)
  })

  it('moves a choice and reports the label limit of each kind', () => {
    const { state, field } = mountField('radio')
    field.options[0]!.title = 'أ'
    field.options[1]!.title = 'ب'
    state.moveOption(0, 1)
    expect(field.options.map(option => option.title)).toEqual(['ب', 'أ'])
    expect(mountField('opt_in').state.labelMax).toBe(120)
    expect(mountField('text_input').state.labelMax).toBe(20)
    expect(mountField('heading').state.textMax).toBe(80)
    expect(mountField('caption').state.textMax).toBe(409)
  })

  it('flags the property a problem names', () => {
    const { state } = mountField('text_input', [{ screen: 0, field: 0, prop: 'label', code: 'invalid' }])
    expect(state.flagged('label')).toBe(true)
    expect(state.flagged('key')).toBe(false)
    expect(state.messages).toEqual(['inbox.flows.problem.invalidProp {"prop":"inbox.flows.prop.label"}'])
  })
})

describe('InboxFlowPicker', () => {
  function mountPicker(items: Array<{ id: number; name: string }>, props: Record<string, unknown>) {
    const query = { data: Vue.ref({ items, total: items.length }), isSuccess: Vue.ref(true), isError: Vue.ref(false), isFetching: Vue.ref(false) }
    return mountScript(url('InboxFlowPicker'), { useInboxSendableFlows: () => query }, { modelValue: null, channelId: 2, ...props })
  }

  it('lists the sendable forms and keeps a chosen form that is no longer on the list', () => {
    const { state } = mountPicker([{ id: 1, name: 'أ' }], { known: { id: 9, name: 'قديم' } })
    expect(state.items).toEqual([{ value: '9', label: 'قديم' }, { value: '1', label: 'أ' }])
    expect(mountPicker([{ id: 1, name: 'أ' }], { known: { id: 1, name: 'أ' } }).state.items).toEqual([{ value: '1', label: 'أ' }])
  })

  it('says so when a channel has no published form, and emits the chosen id or null', () => {
    const empty = mountPicker([], {})
    expect(empty.state.empty).toBe(true)
    empty.state.select('4')
    expect(empty.emitted).toContainEqual(['update:modelValue', 4])
    empty.state.select(undefined)
    expect(empty.emitted).toContainEqual(['update:modelValue', null])
    expect(mountPicker([], { channelId: null }).state.empty).toBe(false)
  })
})
