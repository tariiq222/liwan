import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { InboxContactImportSchema, InboxContactMarketingPatchSchema, type InboxAudience, type InboxContactMarketing } from '@webvue/contracts'
import * as presentation from '../../../composables/inbox/inboxCampaignPresentation'

// The campaign panels' scripts are compiled and run against stubbed composables, as the other component tests do.
function setupOf(file: string, bindings: Record<string, unknown>, props: Record<string, unknown>) {
  const filename = new URL(`../campaigns/${file}`, import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: file }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const emitted: Array<[string, unknown]> = []
  const all = {
    _defineComponent: Vue.defineComponent, _unref: Vue.unref, ref: Vue.ref, reactive: Vue.reactive, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }), ...bindings,
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(all), code)(...Object.values(all))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup(Vue.reactive(props), { expose: () => {}, emit: (name: string, value: unknown) => { emitted.push([name, value]) } })))
  return { state, emitted }
}

const AUDIENCE = {
  id: 3, name: 'عملاء', tags: [{ id: 2, name: 'حجز' }], tag_match: 'any', exclude_tags: [], active_within_days: 30, contact_count: 8, reachable_count: 5, created_at: '2026-10-01T00:00:00Z',
} as InboxAudience

describe('InboxAudienceForm', () => {
  const mount = (props: Record<string, unknown> = {}) => {
    const save = vi.fn(async (_input: { id?: number; body: unknown }) => ({ ...AUDIENCE, id: 9 }))
    return { save, ...setupOf('InboxAudienceForm.vue', {
      useInboxTags: () => ({ data: Vue.ref({ items: [{ id: 1, name: 'شكوى' }, { id: 2, name: 'حجز' }], total: 2 }) }),
      useSaveInboxAudience: () => ({ mutateAsync: save, isPending: Vue.ref(false) }),
    }, { backTo: '/back', ...props }) }
  }

  it('needs a name before it saves', async () => {
    const { state, save } = mount()
    await state.submit()
    expect(save).not.toHaveBeenCalled()
    expect(state.nameError).toBe('inbox.settings.requiredName')
  })

  it('saves the typed segment and emits the audience', async () => {
    const { state, save, emitted } = mount()
    Object.assign(state.draft, { name: ' حجوزات ', tagIds: [1, 2], tagMatch: 'all', excludeTagIds: [3], activeWithinDays: 14 })
    expect(state.dirty).toBe(true)
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: undefined, body: { name: 'حجوزات', tag_ids: [1, 2], tag_match: 'all', exclude_tag_ids: [3], active_within_days: 14 } })
    expect(emitted).toEqual([['saved', expect.objectContaining({ id: 9 })]])
  })

  it('edits a stored audience in place and is clean until changed', async () => {
    const { state, save } = mount({ audience: AUDIENCE })
    expect(state.dirty).toBe(false)
    state.draft.activeWithinDays = 0
    await state.submit()
    expect(save).toHaveBeenCalledWith({ id: 3, body: expect.objectContaining({ name: 'عملاء', tag_ids: [2], active_within_days: 0 }) })
  })
})

describe('InboxContactMarketing', () => {
  const MARKETING: InboxContactMarketing = { contact_id: 5, consent: 'unknown', consent_at: null, consent_source: null, tags: [{ id: 2, name: 'حجز' }], history: [] }
  const mount = (canWrite = true) => {
    const patch = vi.fn((_body: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.())
    return { patch, ...setupOf('InboxContactMarketing.vue', {
      InboxContactMarketingPatchSchema, ...presentation,
      formatDateTime: String,
      useInboxTags: () => ({ data: Vue.ref({ items: [{ id: 2, name: 'حجز' }], total: 1 }) }),
      useInboxContactMarketing: () => ({ data: Vue.ref(MARKETING), isPending: Vue.ref(false), error: Vue.ref(null), refetch: vi.fn() }),
      usePatchInboxContactMarketing: () => ({ mutate: patch, isPending: Vue.ref(false) }),
    }, { contactId: 5, canWrite }) }
  }

  it('records an opt-in only with its proof', () => {
    const { state, patch } = mount()
    state.asking = 'opt_in'
    state.optIn()
    expect(patch).not.toHaveBeenCalled()
    state.proof = '  طلب في العيادة '
    state.optIn()
    expect(patch).toHaveBeenCalledWith({ consent: { state: 'opted_in', note: 'طلب في العيادة' } }, expect.anything())
    expect(state.asking).toBeNull()
    expect(state.proof).toBe('')
  })

  it('records an opt-out without a reason', () => {
    const { state, patch } = mount()
    state.optOut()
    expect(patch).toHaveBeenCalledWith({ consent: { state: 'opted_out' } }, expect.anything())
  })

  it('saves the contact segments as tag ids', () => {
    const { state, patch } = mount()
    state.save({ tag_ids: [2, 7] })
    expect(patch).toHaveBeenCalledWith({ tag_ids: [2, 7] }, expect.anything())
  })

  it('does nothing without the reply capability', () => {
    const { state } = mount(false)
    expect(state.off).toBe(true)
  })
})

describe('contact import contract', () => {
  it('needs a proof note for an opted-in import and accepts an unknown one without', () => {
    const base = { name: 'c.csv', data: 'QUJD', tag_ids: [] }
    expect(InboxContactImportSchema.safeParse({ ...base, consent: 'opted_in' }).success).toBe(false)
    expect(InboxContactImportSchema.safeParse({ ...base, consent: 'opted_in', consent_note: 'نموذج' }).success).toBe(true)
    expect(InboxContactImportSchema.safeParse({ ...base, consent: 'unknown' }).success).toBe(true)
  })
})
