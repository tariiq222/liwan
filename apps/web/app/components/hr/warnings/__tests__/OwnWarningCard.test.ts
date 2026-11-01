import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrWarning } from '@liwan/contracts'
import { hrWarningBadge, ownHrWarningActions } from '../../../../utils/hrWarnings'

// The contest editor belongs to a warning that can still be answered. A refresh that makes the warning final
// (acknowledged, contested, withdrawn, answers switched off) closes the editor, drops the typed note and keeps
// the editor from rendering again, even if the open flag is set later.
const FILE = resolve(import.meta.dirname, '../OwnWarningCard.vue')
const transpile = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText

function warning(over: Partial<HrWarning> = {}): HrWarning {
  return {
    id: 5, employee: { id: 7, name: 'Noura' }, type: { id: 2, name: 'Written warning', severity: 2 },
    date_issued: '2026-10-01', reason: 'Late three times', corrective_action: null, state: 'issued',
    acknowledgement: 'required', ack_pending: true, issued_by: null, issued_at: null, acknowledged_at: null,
    contested_at: null, contest_note: null, withdrawn_by: null, withdrawn_at: null, withdraw_reason: null, revision: 1,
    ...over,
  }
}

function mount(initial: HrWarning) {
  const descriptor = parse(readFileSync(FILE, 'utf8'), { filename: FILE }).descriptor
  const script = compileScript(descriptor, { id: 'own-warning-card' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, watch: Vue.watch,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true), ownHrWarningActions, hrWarningBadge,
    formatDate: (value: string) => value,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const emit = vi.fn()
  const props = Vue.reactive({ warning: initial, pending: false, error: undefined as string | undefined })
  const state = component.setup(props, { expose: () => {}, emit })
  const compiled = compileTemplate({ source: descriptor.template!.content, filename: FILE, id: 'own-warning-card', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', transpile(compiled.code))(Vue)
  async function editorRendered() {
    let editor = false
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state }), render }))
    const pass = (name: string) => Vue.defineComponent({ inheritAttrs: false, setup(_, { slots }) {
      return () => { if (name === 'SharedInlineConfirm') editor = true; return Vue.h('div', [slots.default?.()]) }
    } })
    for (const name of new Set([...descriptor.template!.content.matchAll(/<([A-Z]\w*)/g)].map(m => m[1]!))) app.component(name, pass(name))
    await renderToString(app)
    return editor
  }
  return { props, state, emit, editorRendered }
}

describe('OwnWarningCard contest editor', () => {
  it.each([
    ['acknowledged', { state: 'acknowledged', ack_pending: false }],
    ['contested', { state: 'contested', ack_pending: false, contest_note: 'no notice' }],
    ['withdrawn', { state: 'withdrawn', ack_pending: false }],
    ['answers switched off', { acknowledgement: 'off', ack_pending: false }],
  ] as const)('closes and clears the editor when the warning refreshes to %s, and it cannot reappear', async (_name, patch) => {
    const card = mount(warning())
    card.state.contesting.value = true
    card.state.note.value = 'I was never told'
    expect(await card.editorRendered()).toBe(true)

    card.props.warning = warning(patch as Partial<HrWarning>)
    await Vue.nextTick()
    expect(card.state.contesting.value).toBe(false)
    expect(card.state.note.value).toBe('')

    // Even a late open flag does not render the editor or send a contest for an unanswerable warning.
    card.state.contesting.value = true
    card.state.note.value = 'late text'
    expect(await card.editorRendered()).toBe(false)
    card.state.sendContest()
    expect(card.emit).not.toHaveBeenCalled()
  })

  it('keeps the editor and the text while the warning stays answerable', async () => {
    const card = mount(warning())
    card.state.contesting.value = true
    card.state.note.value = ' still typing '
    card.props.warning = warning({ revision: 2 })
    await Vue.nextTick()
    expect(card.state.contesting.value).toBe(true)
    expect(await card.editorRendered()).toBe(true)
    card.state.sendContest()
    expect(card.emit).toHaveBeenCalledWith('contest', 'still typing')
  })
})
