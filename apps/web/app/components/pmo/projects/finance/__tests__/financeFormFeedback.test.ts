import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import * as finance from '../../../../../utils/projectFinance'
import { ApiError } from '../../../../../composables/useApi'
import * as fields from '../../../../../../../../node_modules/@nuxt/ui/dist/runtime/composables/useFormField.js'

const root = resolve(import.meta.dirname, '../../../../../../../..')
const currency = { id: 1, name: 'SAR', symbol: 'SAR', decimal_places: 2 }
const translations = JSON.parse(readFileSync(resolve(root, 'apps/web/i18n/locales/ar/projects.json'), 'utf8'))
function t(key: string) { return key.split('.').reduce((value, part) => value?.[part], translations) ?? key }
function compile(file: string, bindings: Record<string, unknown>) {
  const descriptor = parse(readFileSync(file, 'utf8'), { filename: file }).descriptor
  const script = compileScript(descriptor, { id: 'finance-feedback' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '')
    .replace('export default', 'return')
  const js = (source: string) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
  const component = new Function(...Object.keys(bindings), js(script))(...Object.values(bindings))
  const template = compileTemplate({ source: descriptor.template!.content, filename: file, id: 'finance-feedback', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
  const render = new Function('Vue', js(template.code))(Vue)
  return { component, render }
}

async function form(options: { pending?: boolean, hydrated?: boolean, writeAllowed?: boolean } = {}) {
  const create = vi.fn(async ({ body }: { body: unknown }) => ({ id: 1, ...body as object }))
  const emitted = vi.fn()
  const scope = Vue.effectScope()
  const compiled = compile(resolve(root, 'apps/web/app/components/pmo/projects/finance/FinanceEntryForm.vue'), {
    // Bind runtime functions explicitly; namespace metadata is not a valid parameter.
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    ...finance, _defineComponent: Vue.defineComponent, ApiError, FinanceBudgetPicker: {},
    useI18n: () => ({ t }), useHydrated: () => Vue.ref(options.hydrated !== false),
    useCreateFinanceEntry: () => ({ mutateAsync: create, isPending: Vue.ref(!!options.pending) }),
    useUpdateFinanceEntry: () => ({ mutateAsync: vi.fn(), isPending: Vue.ref(false) }),
    useProjectFinanceEntry: () => ({ refetch: vi.fn() }),
  })
  const props = { projectId: 1, currency, writeAllowed: options.writeAllowed, defaultKind: 'budget' }
  const state = scope.run(() => compiled.component.setup(props, { expose: () => {}, emit: emitted }))
  // Use Nuxt UI's actual FormField and useFormField injection behavior. Only
  // styling, primitives and specialized controls are replaced for node SSR.
  const field = compile(resolve(root, 'node_modules/@nuxt/ui/dist/runtime/components/FormField.vue'), {
    computed: Vue.computed, ref: Vue.ref, watch: Vue.watch,
    inject: Vue.inject, provide: Vue.provide, useId: Vue.useId,
    ...fields, _useSlots: Vue.useSlots, theme: {}, useAppConfig: () => ({ ui: {} }),
    useComponentProps: (_name: string, value: unknown) => value,
    tv: () => () => new Proxy({}, { get: () => () => '' }), Primitive: {}, Label: {},
  })
  const Field = Vue.defineComponent({ ...field.component, setup: (props: Record<string, unknown>, context: Vue.SetupContext) => Object.fromEntries(Object.entries(field.component.setup(props, context)).filter(([key]) => !key.startsWith('_'))), render: field.render })
  let buttons: Record<string, unknown>[] = []
  async function render() {
    buttons = []
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state, ...props }), render: compiled.render }))
    const passthrough = Vue.defineComponent({ inheritAttrs: false, setup: (_, { slots }) => () => Vue.h('div', slots.default?.()) })
    for (const name of ['SharedFormSection', 'SharedUnsavedChanges', 'FinanceBudgetPicker']) app.component(name, passthrough)
    for (const [name, tag] of [['Primitive', 'div'], ['Label', 'label']]) {
      app.component(name!, Vue.defineComponent({ setup: (_, { attrs, slots }) => () => Vue.h(tag!, attrs, slots.default?.()) }))
    }
    app.component('UFormField', Field)
    for (const name of ['UInput', 'UTextarea', 'USelect', 'SharedDateField']) {
      app.component(name, Vue.defineComponent({ inheritAttrs: false, props: ['id', 'modelValue', 'disabled'], setup(inputProps, { attrs }) {
        const input = fields.useFormField(inputProps)
        return () => Vue.h(name === 'UTextarea' ? 'textarea' : 'input', { ...attrs, ...input.ariaAttrs.value, id: input.id.value, name: input.name.value, disabled: inputProps.disabled, value: inputProps.modelValue })
      } }))
    }
    app.component('UButton', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs, slots }) => () => { buttons.push({ ...attrs }); return Vue.h('button', { type: attrs.type }, slots.default?.()) } }))
    app.component('UAlert', Vue.defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => Vue.h('div', { role: 'alert' }, String(attrs.title ?? '')) }))
    return renderToString(app)
  }
  return { state, create, emitted, render, get buttons() { return buttons }, stop: () => scope.stop() }
}

function inputTag(html: string, id: string) { return html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))?.[0] ?? '' }

describe('finance form inline validation', () => {
  it('disables browser validation while retaining required title and amount semantics', async () => {
    const page = await form()
    const html = await page.render()
    expect(html.match(/<form[^>]*>/)?.[0]).toContain('novalidate')
    expect(inputTag(html, 'finance-title')).toContain('required')
    expect(inputTag(html, 'finance-amount')).toContain('required')
    page.stop()
  })

  it('connects translated field errors to the required controls and clears them on valid submit', async () => {
    const page = await form()
    await page.state.submit()
    const html = await page.render()
    for (const id of ['finance-title', 'finance-amount']) {
      const input = inputTag(html, id)
      expect(input).toContain('aria-invalid="true"')
      const described = input.match(/aria-describedby="([^"]+)"/)?.[1]?.split(' ') ?? []
      expect(described.some(id => html.includes(`id="${id}" data-slot="error"`))).toBe(true)
    }
    expect(html).toContain(t('projects.finance.errors.required'))
    expect(page.create).not.toHaveBeenCalled()
    Object.assign(page.state.draft.value, { title: '  Corrected  ', amountInput: '12.50' })
    expect(page.state.dirty.value).toBe(true)
    await page.state.submit()
    expect(page.create).toHaveBeenCalledExactlyOnceWith({ projectId: 1, body: { kind: 'budget', title: 'Corrected', amount: 12.5 } })
    expect(page.state.fieldErrors.value).toEqual({})
    expect(page.state.dirty.value).toBe(false)
    expect(page.emitted).toHaveBeenCalledWith('saved', expect.objectContaining({ id: 1 }))
    page.stop()
  })

  it('renders general errors above fields while retaining the dirty draft', async () => {
    const page = await form()
    Object.assign(page.state.draft.value, { title: 'Draft', amountInput: '12.50' })
    page.create.mockRejectedValueOnce(new Error('offline'))
    await page.state.submit()
    const html = await page.render()
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('id="finance-title"'))
    expect(page.state.draft.value.title).toBe('Draft')
    expect(page.state.dirty.value).toBe(true)
    page.stop()
  })

  it.each([{ pending: true }, { hydrated: false }, { writeAllowed: false }])('preserves submit guards %j', async options => {
    const page = await form(options)
    Object.assign(page.state.draft.value, { title: 'Draft', amountInput: '12.50' })
    await page.state.submit()
    await page.render()
    const submit = page.buttons.find(button => button.type === 'submit')
    expect(submit?.disabled).toBe(true)
    if (options.pending) expect(submit?.loading).toBe(true)
    expect(page.create).not.toHaveBeenCalled()
    expect(page.state.dirty.value).toBe(true)
    page.stop()
  })
})
