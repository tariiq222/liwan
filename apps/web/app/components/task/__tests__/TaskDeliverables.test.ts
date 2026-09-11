import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../TaskDeliverables.vue')
const source = readFileSync(filename, 'utf8')

function loadProductionSetup(mutateAsync: (args: unknown) => Promise<unknown>) {
  const script = compileScript(parse(source, { filename }).descriptor, { id: 'task-deliverables-production' }).content
  const code = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as Record<string, unknown> }
  const apiError = class ApiError extends Error {}
  const require = (name: string) => {
    if (name === 'vue') return Vue
    if (name === '@/composables/useApi') return { ApiError: apiError }
    if (name === '@/composables/useTasks') return { useUpdateTask: () => ({ mutateAsync, isPending: Vue.ref(false) }) }
    throw new Error(`Unexpected import: ${name}`)
  }
  new Function('require', 'module', 'exports', 'useI18n', 'useHydrated', 'ref', 'computed', code)(
    require,
    module,
    module.exports,
    () => ({ t: (key: string) => key }),
    () => Vue.ref(true),
    Vue.ref,
    Vue.computed,
  )
  return module.exports.default as { setup: (props: unknown, context: unknown) => Record<string, unknown> }
}

function loadTaskDeliverables() {
  const parsed = parse(source, { filename })
  if (!parsed.descriptor.template) throw new Error('TaskDeliverables.vue has no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'task-deliverables',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction

  return defineComponent({
    props: {
      task: { type: Object, required: true },
      hydrated: { type: Boolean, default: true },
    },
    setup(props) {
      const task = computed(() => props.task as { id: number; can_write: boolean; deliverables?: Array<{ name: string; done: boolean }> })
      const deliverables = computed(() => task.value.deliverables ?? [])
      const busy = false
      const error = null
      const hydrated = computed(() => props.hydrated)
      const t = (key: string) => key
      const toggle = () => {}
      return { task, deliverables, busy, error, hydrated, t, toggle }
    },
    render,
  })
}

async function renderTask(task: { id: number; can_write: boolean; deliverables?: Array<{ name: string; done: boolean }> }, hydrated = true) {
  const app = createSSRApp({ render: () => h(loadTaskDeliverables(), { task, hydrated }) })
  app.component('UCheckbox', defineComponent({
    props: ['modelValue', 'disabled'],
    setup(props) { return () => h('input', { type: 'checkbox', checked: props.modelValue, disabled: props.disabled }) },
  }))
  return renderToString(app)
}

describe('TaskDeliverables', () => {
  it('does not add a section for tasks without outputs', async () => {
    const html = await renderTask({ id: 1, can_write: true, deliverables: [] })
    expect(html).not.toContain('data-testid="task-deliverables"')
  })

  it('renders completed and open outputs as an optional checklist', async () => {
    const html = await renderTask({
      id: 2,
      can_write: true,
      deliverables: [{ name: 'Runbook', done: true }, { name: 'Training', done: false }],
    })
    expect(html).toContain('data-testid="task-deliverables"')
    expect(html).toContain('Runbook')
    expect(html).toContain('Training')
    expect(html).toContain('checked')
    expect(html).toContain('tasks.deliverables.checklistOf')
  })

  it('keeps output toggles disabled for read-only or pre-hydration users', async () => {
    const readOnly = await renderTask({ id: 3, can_write: false, deliverables: [{ name: 'Output', done: false }] })
    const preHydration = await renderTask({ id: 4, can_write: true, deliverables: [{ name: 'Output', done: false }] }, false)
    expect(readOnly).toContain('disabled')
    expect(preHydration).toContain('disabled')
  })

  it('preserves the controlled checkbox value on a rejected toggle and blocks a second request while pending', async () => {
    let rejectMutation!: (cause: Error) => void
    const mutation = new Promise((_, reject) => { rejectMutation = reject })
    const mutateAsync = vi.fn(() => mutation)
    const component = loadProductionSetup(mutateAsync)
    const props = Vue.reactive({
      task: {
        id: 5,
        can_write: true,
        deliverables: [{ name: 'Output A', done: false }, { name: 'Output B', done: false }],
      },
    })
    const state = component.setup(props, { emit: () => {}, expose: () => {} })
    const firstToggle = (state.toggle as (index: number) => Promise<void>)(0)
    expect(props.task.deliverables[0]?.done).toBe(false)
    void (state.toggle as (index: number) => Promise<void>)(1)
    expect(mutateAsync).toHaveBeenCalledTimes(1)

    rejectMutation(new Error('save failed'))
    await firstToggle
    expect(props.task.deliverables[0]?.done).toBe(false)
    expect((state.error as Vue.Ref<string | null>).value).toBe('errors.generic')
    expect((state.busy as Vue.ComputedRef<boolean>).value).toBe(false)
  })
})
