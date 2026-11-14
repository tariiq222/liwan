import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyTax } from '@liwan/contracts'
import { ApiError } from '../../../composables/useApi'
import { useSettingsForm } from '../../../composables/settings/useSettingsForm'
import { chooseOption, chosenOption, optionLocked, taxDraft, taxErrorKey, taxUpdate } from '../../../composables/companyTax'

const TAX: CompanyTax = { registered: true, price_mode: 'included', choice: 'included', locked: false, can_change: true, is_root_session: true }
const LOCKED: CompanyTax = { ...TAX, locked: true }

beforeEach(() => { vi.stubGlobal('useI18n', () => ({ t: (key: string) => messages[key] ?? key })) })

// The script of the tax card, compiled and run with the settings-form composable stubbed to hand back its options, so the
// save step runs exactly as the card wires it.
function run(tax: CompanyTax = TAX, vatNumber: string | null = '300000000000003') {
  const filename = new URL('../CompanyTaxCard.vue', import.meta.url).pathname
  const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'CompanyTaxCard' }).content
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  const mutateAsync = vi.fn(async (patch: object) => ({ ...tax, ...patch }))
  let options: { save: (draft: { registered: boolean; priceMode: 'included' | 'added' }, latest: CompanyTax) => Promise<CompanyTax> } | undefined
  const draft = Vue.ref(taxDraft(tax))
  const base = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed, reactive: Vue.reactive, watch: Vue.watch, ApiError,
    chooseOption, chosenOption, optionLocked, taxDraft, taxErrorKey, taxUpdate,
    useI18n: () => ({ t: (key: string) => key }), useToast: () => ({ add: vi.fn() }), useHydrated: () => Vue.ref(true),
    useAccess: () => ({ can: () => false }),
    useSaveCompanyTax: () => ({ mutateAsync }),
    useSettingsForm: (given: typeof options) => { options = given; draft.value = taxDraft(tax); return { draft, state: Vue.ref({ saving: false, reloading: false }), save: vi.fn(), revert: vi.fn(), reload: vi.fn() } },
  }
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
  const component = new Function(...Object.keys(base), code)(...Object.values(base))
  const state = Vue.proxyRefs(Vue.effectScope().run(() => component.setup({ tax, vatNumber, reloadTax: async () => tax }, { expose: () => {}, emit: () => {} })))
  return { state, mutateAsync, save: (values: { registered: boolean; priceMode: 'included' | 'added' }) => options!.save(values, tax) }
}

describe('CompanyTaxCard: who may change the choice', () => {
  it('is editable in the root company for the VAT right holder', () => {
    expect(run().state.canEdit).toBe(true)
  })

  it('is read-only in a branch session, naming the main company as the place it changes', () => {
    const { state } = run({ ...TAX, can_change: false, is_root_session: false })
    expect(state.canEdit).toBe(false)
    expect(state.readOnlyReason).toBe('settings.company.tax.changedFromRoot')
  })

  it('is read-only without the right, naming the missing permission', () => {
    const { state } = run({ ...TAX, can_change: false })
    expect(state.canEdit).toBe(false)
    expect(state.readOnlyReason).toBe('settings.company.vatManageHint')
  })
})

describe('CompanyTaxCard: the options and the lock', () => {
  it('offers the three choices with their worked examples', () => {
    const { state } = run()
    expect(state.choices.map((option: { value: string }) => option.value)).toEqual(['none', 'included', 'added'])
    expect(state.priceModes.map((option: { value: string }) => option.value)).toEqual(['included', 'added'])
    expect(state.choices.map((option: { label: string }) => option.label)).toEqual([
      'settings.company.tax.choices.none.label', 'settings.company.tax.choices.included.label', 'settings.company.tax.choices.added.label',
    ])
  })

  it('disables another price mode with its reason once the establishment is locked, keeping "no tax" open', () => {
    const { state } = run(LOCKED)
    const byValue = Object.fromEntries(state.choices.map((option: { value: string; disabled: boolean; disabledReason?: string }) => [option.value, option]))
    expect(byValue.added.disabled).toBe(true)
    expect(byValue.added.disabledReason).toBe('settings.company.tax.lockedOption')
    expect(byValue.included.disabled).toBe(false)
    expect(byValue.none.disabled).toBe(false)
  })
})

describe('CompanyTaxCard: saving', () => {
  it('sends only the changed fields', async () => {
    const { save, mutateAsync } = run()
    await save({ registered: false, priceMode: 'included' })
    expect(mutateAsync).toHaveBeenCalledWith({ registered: false })
  })

  it('holds back registering without a VAT number, naming the profile field', async () => {
    const { save, mutateAsync } = run({ ...TAX, registered: false, choice: 'none' }, null)
    // The card's own guard for a missing number, not the server's refusal of an invalid one.
    await expect(save({ registered: true, priceMode: 'included' })).rejects.toMatchObject({ field: 'vat', message: 'settings.company.errors.vatRequired' })
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('shows the owning locale message for the lock refusal', async () => {
    const refusing = run()
    refusing.mutateAsync.mockRejectedValueOnce(new ApiError(409, 'tax_mode_locked', 'locked'))
    await expect(refusing.save({ registered: true, priceMode: 'added' })).rejects.toMatchObject({ message: 'settings.company.tax.errors.locked' })
  })
})

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
  createElement: type => node(type), createText: text => node('text', text), createComment: text => node('comment', text),
  setText: (el, text) => { el.text = text }, setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent, nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})
const all = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(all)]
const text = (root: HostNode): string => root.text + root.children.map(text).join('')
const byTestId = (root: HostNode, id: string) => all(root).find(el => el.props['data-testid'] === id)

// The card's real <script setup> and template, rendered through host nodes: the shared card, the option groups and the
// alerts are stand-ins that expose what the card hands them, so a test reads the rendered state rather than its source.
const filename = new URL('../CompanyTaxCard.vue', import.meta.url).pathname
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const compiled = ts.transpileModule(compileScript(descriptor, { id: 'company-tax-card-behavior', inlineTemplate: true }).content, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText

const messages: Record<string, string> = {
  'settings.company.tax.title': 'ضريبة المنشأة', 'settings.company.tax.hint': 'اختيار واحد للمنشأة',
  'settings.company.tax.question': 'هل المنشأة مسجّلة في ضريبة القيمة المضافة؟',
  'settings.company.tax.futureMode.question': 'بعد التسجيل، ماذا يعني السعر؟',
  'settings.company.tax.futureMode.hint': 'اختر الآن', 'settings.company.tax.lockNotice': 'لا يتغير بعد أول قيد',
  'settings.company.tax.changedFromRoot': 'تُغيَّر من الشركة الرئيسية', 'settings.company.vatManageHint': 'تحتاج صلاحية',
  'settings.company.tax.lockedOption': 'هذا الخيار مثبَّت', 'settings.company.tax.saved': 'حُفظ',
  'settings.company.errors.vatRequired': 'أدخل الرقم الضريبي',
}

const MODULES: Record<string, unknown> = {
  'vue': Vue,
  '@/composables/useApi': { ApiError },
  '@/composables/useCompanyTax': { useSaveCompanyTax: () => ({ mutateAsync: MODULES.mutateAsync as (patch: object) => Promise<CompanyTax> }) },
  '@/composables/settings/useSettingsForm': { useSettingsForm },
  '@/composables/companyTax': { chooseOption, chosenOption, optionLocked, taxDraft, taxErrorKey, taxUpdate },
}

function loadCard(mutateAsync: (patch: object) => Promise<CompanyTax>, capabilities: string[]) {
  MODULES.mutateAsync = mutateAsync
  const require = (specifier: string) => {
    if (specifier in MODULES) return MODULES[specifier]
    throw new Error(`CompanyTaxCard.vue imports ${specifier}; declare it in MODULES`)
  }
  const globals = {
    ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => messages[key] ?? key }), useHydrated: () => Vue.ref(true), useToast: () => ({ add: vi.fn() }),
    useAccess: () => ({ can: (capability: string) => capabilities.includes(capability) }),
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), compiled)(require, exports, ...Object.values(globals))
  return exports.default!
}

function mount(tax: CompanyTax, vatNumber: string | null = '300000000000003', capabilities: string[] = []) {
  const mutateAsync = vi.fn(async (patch: object) => ({ ...tax, ...patch }) as CompanyTax)
  const Component = loadCard(mutateAsync, capabilities)
  const app = renderer.createApp({ render: () => Vue.h(Component, { tax, vatNumber, reloadTax: async () => tax }) })
  const card = Vue.defineComponent({
    inheritAttrs: false,
    props: ['title', 'description', 'canEdit', 'dirty', 'onSave'],
    setup(props, { attrs, slots }) {
      return () => Vue.h('section', { 'data-testid': attrs['data-testid'], 'data-can-edit': props.canEdit, 'data-dirty': props.dirty }, [
        Vue.h('button', { 'data-testid': 'company-tax-save', onClick: () => props.onSave?.() }), slots.default?.(),
      ])
    },
  })
  const alert = Vue.defineComponent({
    inheritAttrs: false,
    props: ['description'],
    setup(props, { attrs }) { return () => Vue.h('div', { 'data-testid': attrs['data-testid'], role: 'alert' }, props.description) },
  })
  const optionCards = Vue.defineComponent({
    inheritAttrs: false,
    props: ['modelValue', 'options', 'disabled', 'label'],
    emits: ['update:modelValue'],
    setup(props, { attrs, emit }) {
      return () => Vue.h('div', { role: 'radiogroup', 'aria-label': props.label, 'data-testid': attrs['data-testid'], 'data-disabled': props.disabled === true ? 'true' : undefined },
        props.options.map((option: { value: string; label: string; description?: string; disabled?: boolean; disabledReason?: string }) => Vue.h('button', {
          role: 'radio', type: 'button', 'data-option': option.value, 'aria-checked': option.value === props.modelValue ? 'true' : 'false',
          disabled: props.disabled === true || option.disabled === true, onClick: () => emit('update:modelValue', option.value),
        }, [option.label, option.description ?? '', option.disabledReason ?? ''])))
    },
  })
  app.component('SharedSettingsCard', card)
  app.component('UAlert', alert)
  app.component('SharedOptionCards', optionCards)
  const root = node(); app.mount(root)
  const options = (testId: string) => {
    const group = byTestId(root, testId)
    return group ? group.children.map(child => ({ value: child.props['data-option'] as string, label: text(child), disabled: child.props.disabled === true })) : []
  }
  const pick = (testId: string, value: string) => {
    const group = byTestId(root, testId)!
    group.children.find(child => child.props['data-option'] === value)!.props.onClick()
  }
  return { app, root, mutateAsync, options, pick, save: () => byTestId(root, 'company-tax-save')!.props.onClick() }
}
const settle = async () => { await new Promise(resolve => setTimeout(resolve)); await Vue.nextTick() }

describe('CompanyTaxCard: the rendered choice', () => {
  it('asks one question with the three choices and their own explanations', () => {
    const card = mount(TAX)
    const group = byTestId(card.root, 'company-tax-choice')!
    expect(group.props['aria-label']).toBe('هل المنشأة مسجّلة في ضريبة القيمة المضافة؟')
    expect(card.options('company-tax-choice').map(option => option.value)).toEqual(['none', 'included', 'added'])
    expect(card.options('company-tax-choice').map(option => option.label)).toEqual([
      'settings.company.tax.choices.none.labelsettings.company.tax.choices.none.hint',
      'settings.company.tax.choices.included.labelsettings.company.tax.choices.included.hint',
      'settings.company.tax.choices.added.labelsettings.company.tax.choices.added.hint',
    ])
    card.app.unmount()
  })

  it('shows the "price mode after registering" question only while unregistered, as its own group', () => {
    const registered = mount(TAX)
    expect(byTestId(registered.root, 'company-tax-future-mode')).toBeUndefined()
    registered.app.unmount()

    const unregistered = mount({ ...TAX, registered: false, choice: 'none' })
    const group = byTestId(unregistered.root, 'company-tax-price-mode')!
    expect(byTestId(unregistered.root, 'company-tax-future-mode')).toBeTruthy()
    expect(group.props['aria-label']).toBe('بعد التسجيل، ماذا يعني السعر؟')
    expect(group.props['aria-label']).not.toBe(byTestId(unregistered.root, 'company-tax-choice')!.props['aria-label'])
    expect(unregistered.options('company-tax-price-mode').map(option => option.value)).toEqual(['included', 'added'])
    unregistered.app.unmount()
  })

  it('disables a price mode the first accounting entry locked, with its reason', () => {
    const card = mount(LOCKED)
    const added = card.options('company-tax-choice').find(option => option.value === 'added')!
    expect(added.disabled).toBe(true)
    expect(added.label).toContain('هذا الخيار مثبَّت')
    expect(card.options('company-tax-choice').find(option => option.value === 'included')!.disabled).toBe(false)
    expect(card.options('company-tax-choice').find(option => option.value === 'none')!.disabled).toBe(false)
    card.app.unmount()
  })

  it('shows the lock notice on every state', () => {
    const card = mount(TAX)
    expect(text(byTestId(card.root, 'company-tax-lock')!)).toBe('لا يتغير بعد أول قيد')
    card.app.unmount()
  })
})

describe('CompanyTaxCard: the rendered read-only state', () => {
  it('tells a branch session the main company changes it', () => {
    const card = mount({ ...TAX, can_change: false, is_root_session: false })
    expect(text(byTestId(card.root, 'company-tax-readonly')!)).toBe('تُغيَّر من الشركة الرئيسية')
    expect(byTestId(card.root, 'company-tax')!.props['data-can-edit']).toBe(false)
    card.app.unmount()
  })

  it('names the missing right for a root session without it', () => {
    const card = mount({ ...TAX, can_change: false })
    expect(text(byTestId(card.root, 'company-tax-readonly')!)).toBe('تحتاج صلاحية')
    card.app.unmount()
  })

  it('gives no reason of its own to a root session that holds the right and is read-only', () => {
    const card = mount({ ...TAX, can_change: false }, undefined, ['settings.company.vat.manage'])
    expect(byTestId(card.root, 'company-tax-readonly')).toBeFalsy()
    expect(byTestId(card.root, 'company-tax')!.props['data-can-edit']).toBe(false)
    card.app.unmount()
  })
})

describe('CompanyTaxCard: saving from the rendered card', () => {
  it('sends only the future price mode when an unregistered establishment picks one', async () => {
    const card = mount({ ...TAX, registered: false, choice: 'none', price_mode: 'included' })
    card.pick('company-tax-price-mode', 'added')
    card.save(); await settle()
    expect(card.mutateAsync).toHaveBeenCalledWith({ price_mode: 'added' })
    card.app.unmount()
  })

  it('sends only the registration when the establishment turns tax off', async () => {
    const card = mount(TAX)
    card.pick('company-tax-choice', 'none')
    card.save(); await settle()
    expect(card.mutateAsync).toHaveBeenCalledWith({ registered: false })
    card.app.unmount()
  })
})
