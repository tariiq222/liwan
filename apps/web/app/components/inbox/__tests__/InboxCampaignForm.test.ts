import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { InboxCampaign, InboxTemplate } from '@webvue/contracts'
import * as params from '../../../composables/inbox/inboxCampaignParams'

const filename = new URL('../campaigns/InboxCampaignForm.vue', import.meta.url).pathname
const template = (id: number, rest: Partial<InboxTemplate> = {}): InboxTemplate => ({
  id, name: `t${id}`, language: 'ar', category: 'marketing', status: 'approved', status_reason: null, quality: 'green', header: null, body: 'مرحبًا {{1}} {{2}}', body_examples: ['a', 'b'],
  footer: null, buttons: [], add_security_recommendation: false, code_expiration_minutes: null, otp_button_text: null, param_count: 2, editable: true, supported: true, ...rest,
})
const TEMPLATES = [template(1), template(2, { param_count: 0, body: 'عرض' }), template(3, { category: 'authentication' }), template(4, { param_count: 0, body: 'x', header: { type: 'image', example_attachment: null } })]
const STORED = {
  id: 7, name: 'عروض', state: 'draft', channel: { id: 1, name: 'ق' }, template: { id: 1, name: 't1', language: 'ar', category: 'marketing' }, audience: { id: 2, name: 'ج' },
  params: [{ location: 'body', position: 1, source: 'contact_first_name', value: null }, { location: 'body', position: 2, source: 'static', value: 'الخميس' }],
  header_attachment: null, scheduled_at: null, send_within_hours: false, daily_cap: 25,
} as unknown as InboxCampaign

// The component script is compiled and run against stubbed composables, as the other component tests do.
function mountForm(props: { campaign?: InboxCampaign } = {}, dailyCap = 100) {
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'inbox-campaign-form' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const save = vi.fn(async (_input: { id?: number; body: unknown }) => ({ ...STORED, id: 9 }))
  const previewCalls: unknown[] = []
  const emitted: Array<[string, unknown]> = []
  const bindings = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }),
    refDebounced: <T>(source: Vue.Ref<T>) => source,
    ...params, InboxTemplatePreview: {}, InboxCampaignContactPicker: {}, InboxCampaignParamsMapper: {}, HEADER_MEDIA_ACCEPT: {}, inboxUploadProblem: () => null,
    useSaveInboxCampaign: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    useUploadInboxCampaignHeader: () => ({ mutateAsync: vi.fn() }),
    useInboxCampaignChannels: () => ({ data: Vue.ref({ items: [{ id: 1, name: 'ق' }], total: 1 }) }),
    useInboxAudienceChoices: () => ({ data: Vue.ref({ items: [{ id: 2, name: 'ج', reachable_count: 5, contact_count: 8 }], total: 1 }) }),
    useInboxCampaignSettings: () => ({ data: Vue.ref({ default_daily_cap: dailyCap }) }),
    useInboxChannelSending: () => ({ data: Vue.ref(null) }),
    useInboxCampaignPreview: (request: Vue.Ref<unknown>) => { Vue.watchEffect(() => previewCalls.push(request.value)); return { data: Vue.ref(null), isFetching: Vue.ref(false) } },
    useInboxChannelTemplates: () => ({ data: Vue.ref({ items: TEMPLATES, total: TEMPLATES.length }), isFetching: Vue.ref(false) }),
    useInboxTemplate: () => ({ data: Vue.ref(null) }),
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(bindings), code)(...Object.values(bindings))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive({ backTo: '/back', ...props }), { expose: () => {}, emit: (name: string, value: unknown) => { emitted.push([name, value]) } })))
  return { state, save, previewCalls, emitted }
}

describe('InboxCampaignForm', () => {
  it('starts a new campaign from the company\'s default daily cap', () => {
    expect(mountForm({}, 100).state.draft.dailyCap).toBe(100)
  })

  it('shows one mapper row per placeholder of the chosen template, and follows a change of template', async () => {
    const { state } = mountForm()
    state.draft.channelId = 1
    state.draft.templateId = 1
    await Vue.nextTick()
    expect(state.draft.rows.map((row: { location: string; position: number }) => `${row.location}:${row.position}`)).toEqual(['body:1', 'body:2'])
    state.draft.rows[0].value = 'نص'
    state.draft.templateId = 2
    await Vue.nextTick()
    expect(state.draft.rows).toEqual([])
    expect(state.mediaKind).toBeNull()
    state.draft.templateId = 4
    await Vue.nextTick()
    expect(state.mediaKind).toBe('image')
  })

  it('never offers an authentication template', () => {
    const { state } = mountForm()
    state.draft.channelId = 1
    expect(state.templateItems.map((item: { value: number }) => item.value)).toEqual([1, 2, 4])
  })

  it('asks the server to render the preview with only the placeholders that have a value, for the chosen sample contact', async () => {
    const { state, previewCalls } = mountForm()
    state.draft.channelId = 1
    state.draft.templateId = 1
    await Vue.nextTick()
    state.draft.rows[0].source = 'contact_name'
    state.draft.rows[1].value = ''
    state.sampleContactId = 5
    await Vue.nextTick()
    expect(previewCalls.at(-1)).toEqual({ template_id: 1, params: [{ location: 'body', position: 1, source: 'contact_name', value: null }], contact_id: 5 })
  })

  it('sends nothing and shows what is missing until the campaign is complete', async () => {
    const { state, save } = mountForm()
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.nameError).toBe('inbox.settings.requiredName')
    expect(state.channelError).toBe('inbox.campaigns.form.channelRequired')
    expect(state.audienceError).toBe('inbox.campaigns.form.audienceRequired')
  })

  it('creates the campaign with the mapped params and emits it', async () => {
    const { state, save, emitted } = mountForm()
    Object.assign(state.draft, { name: 'عرض', channelId: 1, templateId: 1, audienceId: 2 })
    await Vue.nextTick()
    state.draft.rows[0].source = 'contact_first_name'
    state.draft.rows[1].value = 'الخميس'
    await state.submit()
    expect(save).toHaveBeenCalledWith({
      id: undefined,
      body: expect.objectContaining({
        name: 'عرض', channel_id: 1, template_id: 1, audience_id: 2, scheduled_at: null,
        params: [{ location: 'body', position: 1, source: 'contact_first_name', value: null }, { location: 'body', position: 2, source: 'static', value: 'الخميس' }],
      }),
    })
    expect(emitted).toEqual([['saved', expect.objectContaining({ id: 9 })]])
  })

  it('refuses a media template until its header file is uploaded', async () => {
    const { state, save } = mountForm()
    Object.assign(state.draft, { name: 'صورة', channelId: 1, templateId: 4, audienceId: 2 })
    await Vue.nextTick()
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.headerError).toBe('inbox.campaigns.form.headerRequired')
  })

  it('keeps a stored campaign\'s mapping and is not dirty until something changes', async () => {
    const { state } = mountForm({ campaign: STORED })
    await Vue.nextTick()
    expect(state.draft.rows.map((row: { source: string; value: string }) => [row.source, row.value])).toEqual([['contact_first_name', ''], ['static', 'الخميس']])
    expect(state.dirty).toBe(false)
    state.draft.name = 'اسم آخر'
    expect(state.dirty).toBe(true)
  })

  it('lets a paused campaign change only its name, daily cap and working-hours rule', async () => {
    const { state, save } = mountForm({ campaign: { ...STORED, state: 'paused' } })
    await Vue.nextTick()
    expect(state.locked).toBe(true)
    state.draft.name = 'اسم جديد'
    state.draft.dailyCap = 10
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 7, body: { name: 'اسم جديد', send_within_hours: false, daily_cap: 10 } })
  })
})
