import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

// The panel's markup is compiled from the SFC and rendered with the state its
// script would compute, so each state's buttons and note field are asserted
// without a browser. The transitions themselves are covered by useProjects.
const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../CharterApprovalPanel.vue')

function compilePanel() {
  const source = readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  const compiled = compileTemplate({
    source: parsed.descriptor.template!.content,
    filename,
    id: 'charter-approval-test',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const code = ts.transpileModule(compiled.code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  return new Function('Vue', code)(Vue) as RenderFunction
}

interface Scenario {
  state: 'draft' | 'submitted' | 'approved'
  can_review?: boolean
  can_manage?: boolean
  return_note?: string
  returning?: boolean
  withdrawing?: boolean
  note?: string
  approved_by?: { id: number; name: string } | null
}

async function mountPanel(s: Scenario) {
  const state = s.state
  const canReview = state === 'submitted' && !!s.can_review
  const component = defineComponent({
    setup: () => ({
      t: (key: string, params?: Record<string, string>) => (params ? `${key}:${Object.values(params).join('|')}` : key),
      charter: { state, return_note: s.return_note ?? '' },
      state,
      canReview,
      canWithdraw: state === 'submitted' && !!s.can_manage && !canReview,
      sponsorName: 'Noura',
      approvedLabel: s.approved_by ? `approvedBy:${s.approved_by.name}` : 'projects.charter.state.approved',
      returning: s.returning ?? false,
      withdrawing: s.withdrawing ?? false,
      note: s.note ?? '',
      noteReady: (s.note ?? '').trim().length > 0,
      hydrated: true,
      isPending: false,
      CHARTER_RETURN_NOTE_MAX: 2000,
      run: () => {},
    }),
    render: compilePanel(),
  })
  const app = createSSRApp({ render: () => h(component) })
  app.component('UAlert', defineComponent({
    props: ['title', 'description'],
    setup: (props, { slots, attrs }) => () => h('div', attrs, [props.title, props.description, slots.description?.(), slots.actions?.()]),
  }))
  app.component('SharedInlineConfirm', defineComponent({ props: ['title'], setup: (props, { attrs }) => () => h('div', attrs, props.title) }))
  app.component('UButton', defineComponent({
    props: ['label', 'disabled'],
    setup: (props, { attrs }) => () => h('button', { ...attrs, disabled: props.disabled || undefined }, props.label),
  }))
  app.component('UTextarea', defineComponent({ setup: (_, { attrs }) => () => h('textarea', attrs) }))
  const html = await renderToString(app)
  const has = (id: string) => html.includes(`data-testid="${id}"`)
  return { html, has, buttonDisabled: (id: string) => new RegExp(`<button[^>]*data-testid="${id}"[^>]*disabled`).test(html) || new RegExp(`<button[^>]*disabled[^>]*data-testid="${id}"`).test(html) }
}

describe('CharterApprovalPanel', () => {
  it('offers approve and return only to the reviewing sponsor', async () => {
    const w = await mountPanel({ state: 'submitted', can_review: true })
    expect(w.has('charter-approve')).toBe(true)
    expect(w.has('charter-return')).toBe(true)
    expect(w.has('charter-withdraw')).toBe(false)
    expect(w.html).toContain('projects.charter.waitingFor:Noura')
  })

  it('hides every action from a viewer who can neither review nor manage', async () => {
    const w = await mountPanel({ state: 'submitted' })
    for (const id of ['charter-approve', 'charter-return', 'charter-withdraw']) expect(w.has(id)).toBe(false)
  })

  it('asks for a note inline before returning, disabled while the note is blank', async () => {
    const empty = await mountPanel({ state: 'submitted', can_review: true, returning: true, note: '  ' })
    expect(empty.has('charter-return-note')).toBe(true)
    expect(empty.has('charter-approve')).toBe(false)
    expect(empty.buttonDisabled('charter-return-confirm')).toBe(true)
    const filled = await mountPanel({ state: 'submitted', can_review: true, returning: true, note: 'Add budget' })
    expect(filled.buttonDisabled('charter-return-confirm')).toBe(false)
  })

  it('shows the return note on a returned draft', async () => {
    const w = await mountPanel({ state: 'draft', return_note: 'Add budget' })
    expect(w.has('charter-returned')).toBe(true)
    expect(w.html).toContain('Add budget')
  })

  it('shows the plain draft banner when nothing was returned', async () => {
    const w = await mountPanel({ state: 'draft' })
    expect(w.has('charter-draft-banner')).toBe(true)
    expect(w.has('charter-returned')).toBe(false)
  })

  it('offers withdraw to the manager while submitted, then confirms inline', async () => {
    const w = await mountPanel({ state: 'submitted', can_review: false, can_manage: true })
    expect(w.has('charter-withdraw')).toBe(true)
    expect(w.has('charter-approve')).toBe(false)
    const confirm = await mountPanel({ state: 'submitted', can_manage: true, withdrawing: true })
    expect(confirm.has('charter-withdraw-confirm')).toBe(true)
  })

  it('names the approver on an approved charter', async () => {
    const w = await mountPanel({ state: 'approved', approved_by: { id: 8, name: 'Noura' } })
    expect(w.has('charter-approved')).toBe(true)
    expect(w.html).toContain('approvedBy:Noura')
  })
})
