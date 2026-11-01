import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

// The panel's markup is compiled from the SFC and rendered with the state its script would compute, so each
// state's banner, buttons and note field are asserted without a browser. The requests are covered by useProjectChanges.
const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ChangeDecisionPanel.vue')

function compilePanel() {
  const parsed = parse(readFileSync(filename, 'utf8'), { filename })
  const compiled = compileTemplate({
    source: parsed.descriptor.template!.content,
    filename,
    id: 'change-decision-test',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const code = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  return new Function('Vue', code)(Vue) as RenderFunction
}

interface Scenario {
  state: 'draft' | 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'implemented'
  flags?: Partial<Record<'can_edit' | 'can_submit' | 'can_withdraw' | 'can_decide' | 'can_implement', boolean>>
  confirming?: 'approve' | 'reject' | 'withdraw' | 'implement' | null
  note?: string
}

async function mountPanel(s: Scenario) {
  const item = {
    state: s.state, decision_note: 'Because', decided_by: { id: 1, name: 'Noura' }, decided_at: '2026-10-25T10:00:00Z', implemented_at: null,
    can_edit: false, can_submit: false, can_withdraw: false, can_decide: false, can_implement: false, ...s.flags,
  }
  const confirming = s.confirming ?? null
  const note = s.note ?? ''
  const component = defineComponent({
    setup: () => ({
      t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join('|')}` : key),
      item,
      hydrated: true,
      isPending: false,
      confirming,
      note,
      noteMissing: confirming === 'reject' && !note.trim(),
      askForNote: confirming === 'approve' || confirming === 'reject',
      decidedLabel: 'decided:Noura',
      formatLiwanDate: (value: string | null) => value ?? '',
      CHANGE_NOTE_MAX: 2000,
      close: () => {},
      run: () => {},
    }),
    render: compilePanel(),
  })
  const app = createSSRApp({ render: () => h(component) })
  app.component('UAlert', defineComponent({
    props: ['title', 'description'],
    setup: (props, { slots, attrs }) => () => h('div', attrs, [props.title, props.description, slots.actions?.()]),
  }))
  app.component('SharedInlineConfirm', defineComponent({
    props: ['title', 'disabled', 'confirmLabel'],
    setup: (props, { slots, attrs }) => () => h('div', { ...attrs, 'data-disabled': props.disabled ? 'yes' : undefined }, [props.title, props.confirmLabel, slots.default?.()]),
  }))
  app.component('UFormField', defineComponent({ props: ['label', 'required'], setup: (props, { slots }) => () => h('label', [props.label, props.required ? '*' : '', slots.default?.()]) }))
  app.component('UButton', defineComponent({
    props: ['label', 'disabled'],
    setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled || undefined }, props.label),
  }))
  app.component('UTextarea', defineComponent({ setup: (_, { attrs }) => () => h('textarea', attrs) }))
  const html = await renderToString(app)
  return { html, has: (id: string) => html.includes(`data-testid="${id}"`) }
}

describe('ChangeDecisionPanel', () => {
  it('offers approve and reject only to the sponsor of a submitted request', async () => {
    const sponsor = await mountPanel({ state: 'submitted', flags: { can_decide: true } })
    expect(sponsor.has('change-approve')).toBe(true)
    expect(sponsor.has('change-reject')).toBe(true)
    expect(sponsor.has('change-withdraw')).toBe(false)
    const viewer = await mountPanel({ state: 'submitted' })
    expect(viewer.has('change-approve')).toBe(false)
    expect(viewer.has('change-waiting')).toBe(true)
  })

  it('lets the requester send a draft and withdraw a draft or submitted request', async () => {
    const draft = await mountPanel({ state: 'draft', flags: { can_edit: true, can_submit: true, can_withdraw: true } })
    expect(draft.has('change-submit')).toBe(true)
    expect(draft.has('change-withdraw')).toBe(true)
    expect(draft.has('change-draft-banner')).toBe(true)
    const submitted = await mountPanel({ state: 'submitted', flags: { can_withdraw: true } })
    expect(submitted.has('change-submit')).toBe(false)
    expect(submitted.has('change-withdraw')).toBe(true)
  })

  it('offers the implementation to the manager of an approved request only', async () => {
    expect((await mountPanel({ state: 'approved', flags: { can_implement: true } })).has('change-implement')).toBe(true)
    const other = await mountPanel({ state: 'approved' })
    expect(other.has('change-implement')).toBe(false)
    expect(other.has('change-approved')).toBe(true)
  })

  it('shows a terminal request as a record with no action', async () => {
    for (const state of ['rejected', 'withdrawn', 'implemented'] as const) {
      const w = await mountPanel({ state })
      for (const id of ['change-approve', 'change-reject', 'change-submit', 'change-withdraw', 'change-implement']) expect(w.has(id), `${state} ${id}`).toBe(false)
      expect(w.has(`change-${state}`)).toBe(true)
    }
  })

  it('confirms inline, asks for the rejection reason and blocks an empty one', async () => {
    const reject = await mountPanel({ state: 'submitted', flags: { can_decide: true }, confirming: 'reject' })
    expect(reject.has('change-reject-confirm')).toBe(true)
    expect(reject.has('change-decision-note')).toBe(true)
    expect(reject.html).toContain('projects.changes.noteRequired')
    expect(reject.html).toContain('data-disabled="yes"')
    expect(reject.has('change-approve')).toBe(false)
    const withNote = await mountPanel({ state: 'submitted', flags: { can_decide: true }, confirming: 'reject', note: 'No budget' })
    expect(withNote.html).not.toContain('data-disabled="yes"')
    const approve = await mountPanel({ state: 'submitted', flags: { can_decide: true }, confirming: 'approve' })
    expect(approve.html).toContain('projects.changes.noteOptional')
    expect(approve.html).not.toContain('data-disabled="yes"')
    const withdraw = await mountPanel({ state: 'submitted', flags: { can_withdraw: true }, confirming: 'withdraw' })
    expect(withdraw.has('change-withdraw-confirm')).toBe(true)
    expect(withdraw.has('change-decision-note')).toBe(false)
  })
})
