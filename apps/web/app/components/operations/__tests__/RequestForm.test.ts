import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import { refDebounced } from '@vueuse/core'
import { OperationRequestSchema } from '@webvue/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import * as forms from '../../../composables/operations/forms'

const filename = resolve(import.meta.dirname, '../RequestForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const script = compileScript(descriptor, { id: 'operation-form' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'operation-form', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const render = new Function('Vue', js(template.code))(Vue)
const process = { id: 3, name: 'إجراء', execution_kind: 'approval', state: 'published', revision: 2, description: '', steps: [] }

function form(options: { hydrated?: boolean; disabled?: boolean; kind?: string; targetError?: unknown; record?: Record<string, any>; refreshed?: Record<string, any>; saveError?: unknown; savedRevision?: number; targetItems?: { id: number; name: string; href: string }[] } = {}) {
  const hydrated = Vue.ref(options.hydrated !== false)
  const scope = Vue.effectScope()
  let calls = 0
  let body: unknown
  let release!: () => void
  const props = Vue.reactive({ record: options.record, refresh: async () => options.refreshed, processes: [{ ...process, execution_kind: options.kind ?? 'approval' }], loading: false, processError: undefined, disabled: options.disabled ?? false, backTo: '/operations', save: async (value: unknown) => { calls++; body = value; if (options.saveError) throw options.saveError; await new Promise<void>(resolve => { release = resolve }); return { id: 8, name: 'طلب', description: 'وصف', process: { id: 3, name: 'إجراء' }, process_revision: 2, state: 'draft', revision: options.savedRevision ?? 0, cycle: 0, requester: { id: 2, user_id: 2, name: 'مقدم الطلب' }, created_at: '2026-10-14', execution_count: 0, target: null, steps: [], events: [], attachments: [], allowed_actions: { edit: true, submit: true, approve: false, reject: false, return: false, withdraw: false } } } })
  const bindings = { exports: {}, _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, refDebounced, watch: Vue.watch, nextTick: Vue.nextTick, ...forms, useI18n: () => ({ t: (key: string) => key }), useHydrated: () => hydrated, useOperationTargets: () => ({ data: Vue.ref({ items: options.targetItems ?? [], total: options.targetItems?.length ?? 0 }), error: Vue.ref(options.targetError ?? null), isPending: Vue.ref(false) }) }
  const component = new Function(...Object.keys(bindings), js(script))(...Object.values(bindings))
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: () => {} }))
  async function html() {
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...props, ...state }), render }))
    const passthrough = Vue.defineComponent({ setup: (_, { attrs, slots }) => () => Vue.h('div', attrs, slots.default?.()) })
    for (const name of ['SharedUnsavedChanges', 'SharedFormSection', 'UFormField', 'SharedInlineConfirm']) app.component(name, passthrough)
    for (const name of ['UInput', 'UTextarea', 'USelect']) app.component(name, Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('input', attrs) }))
    app.component('UButton', Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('button', attrs, String(attrs.label)) }))
    app.component('UAlert', Vue.defineComponent({ setup: (_, { attrs }) => () => Vue.h('div', { role: 'alert' }, String(attrs.title)) }))
    return renderToString(app)
  }
  return { state, hydrated, props, html, get calls() { return calls }, get body() { return body }, release: () => release(), stop: () => scope.stop() }
}

describe('operation request form', () => {
  it('disables submission before hydration and never emits an early request', async () => {
    const f = form({ hydrated: false })
    f.state.name.value = 'طلب'; f.state.processId.value = 3
    expect(await f.html()).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
    await f.state.submit()
    expect(f.calls).toBe(0)
    f.hydrated.value = true
    expect(await f.html()).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/)
    f.stop()
  })
  it('shows field errors after submit and omits a related target from ordinary approval', async () => {
    const f = form()
    expect(f.state.fieldError('name')).toBeUndefined()
    await f.state.submit()
    expect(f.state.fieldError('name')).toBe('operations.errors.required')
    expect(f.calls).toBe(0)
    f.state.name.value = ' طلب '; f.state.description.value = 'وصف'; f.state.processId.value = 3
    const pending = f.state.submit()
    await f.state.submit()
    expect(f.calls).toBe(1)
    expect(f.body).toEqual({ name: 'طلب', description: 'وصف', process_id: 3 })
    expect(f.state.dirty.value).toBe(true)
    f.release()
    await pending
    expect(f.state.dirty.value).toBe(false)
    f.stop()
  })
  it('requires an available related target only for a linked procedure', async () => {
    const f = form({ kind: 'pmo_completion', targetItems: [{ id: 5, name: 'مهمة', href: '/projects/1/tasks/5' }] })
    f.state.name.value = 'طلب'; f.state.processId.value = 3
    await f.state.submit()
    expect(f.state.fieldError('target_id')).toBe('operations.errors.required')
    expect(f.calls).toBe(0)
    f.state.targetId.value = 5
    const pending = f.state.submit()
    expect(f.body).toEqual({ name: 'طلب', description: '', process_id: 3, target_id: 5 })
    f.release(); await pending; f.stop()
  })
  it('allows switching to ordinary approval after related targets fail', async () => {
    const f = form({ kind: 'pmo_completion', targetError: { status: 403 } })
    f.props.processes.push({ ...process, id: 4 })
    f.state.name.value = 'طلب'; f.state.processId.value = 3
    await f.state.submit()
    expect(f.calls).toBe(0)
    const selector = (await f.html()).match(/<input[^>]*placeholder="operations.chooseProcess"[^>]*>/)?.[0]
    expect(selector).toBeDefined()
    expect(selector).not.toMatch(/\sdisabled(?:[=>\s])|\sdisabled$/)
    f.state.processId.value = 4
    const pending = f.state.submit()
    expect(f.body).toEqual({ name: 'طلب', description: '', process_id: 4 })
    f.release(); await pending; f.stop()
  })
  it('keeps the accepted revision when refreshed props arrive during a dirty edit', async () => {
    const original = OperationRequestSchema.parse({ purpose: 'work', id: 8, name: 'Original', description: '', revision: 4, process: { id: 3, name: 'إجراء' }, process_revision: 2, state: 'draft', cycle: 0, requester: { id: 2, user_id: 2, name: 'Requester' }, created_at: '2026-10-14', execution_count: 0, target: null, steps: [], events: [], attachments: [], allowed_actions: { edit: true, submit: true, approve: false, reject: false, return: false, withdraw: false } })
    const latest = { ...original, name: 'Server changed', description: 'Latest description', revision: 9 }
    const f = form({ record: original, refreshed: latest, saveError: { status: 409 } })
    f.state.name.value = 'Local draft'
    f.props.record = latest
    await Vue.nextTick()
    expect(f.state.name.value).toBe('Local draft')
    await f.state.submit()
    expect(f.body).toEqual({ name: 'Local draft', description: '', revision: 4 })
    expect(f.state.dirty.value).toBe(true)
    await f.state.requestReload()
    expect(f.state.reloadRequested.value).toBe(true)
    expect(f.state.name.value).toBe('Local draft')
    await f.state.reload() // The inline confirmation accepts replacing the draft.
    expect(f.state.reloadRequested.value).toBe(false)
    expect(f.state.name.value).toBe('Server changed')
    expect(f.state.description.value).toBe('Latest description')
    expect(f.state.dirty.value).toBe(false)
    await f.state.submit()
    expect(f.body).toEqual({ name: 'Server changed', description: 'Latest description', revision: 9 })
    f.stop()
  })
  it('clears target selection while a searchable target query settles', async () => {
    vi.useFakeTimers()
    const f = form({ kind: 'pmo_completion', targetItems: [{ id: 5, name: 'Older item', href: '/tasks/5' }] })
    try {
      f.state.name.value = 'Request'; f.state.processId.value = 3; f.state.targetId.value = 5
      f.state.targetSearch.value = 'Older item'
      expect(f.state.targetId.value).toBeUndefined()
      expect(f.state.blocked.value).toBe(true)
      expect(f.state.processDisabled.value).toBe(false)
      await vi.advanceTimersByTimeAsync(300)
      expect(f.state.targetQuery.value).toBe('Older item')
      expect(f.state.blocked.value).toBe(false)
      await f.state.submit()
      expect(f.calls).toBe(0)
      f.state.targetId.value = 5
      const pending = f.state.submit()
      expect(f.body).toMatchObject({ target_id: 5 })
      f.release(); await pending
    } finally { f.stop(); vi.useRealTimers() }
  })
  it('uses the returned revision after saving a request', async () => {
    const f = form({ record: { id: 8, name: 'Original', description: '', revision: 4, process: { id: 3, name: 'Procedure' } }, savedRevision: 5 })
    f.state.name.value = 'Saved draft'
    let pending = f.state.submit(); f.release(); await pending
    f.state.name.value = 'Second draft'
    pending = f.state.submit()
    expect(f.body).toMatchObject({ name: 'Second draft', revision: 5 })
    f.release(); await pending; f.stop()
  })
  it('keeps all request writes disabled when the owning page denies editing', async () => {
    const f = form({ disabled: true })
    f.state.name.value = 'طلب'; f.state.processId.value = 3
    await f.state.submit()
    expect(f.calls).toBe(0)
    expect(await f.html()).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
    f.stop()
  })
})
