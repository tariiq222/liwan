import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { createRenderer, defineComponent, h, nextTick, reactive } from 'vue'
import type { CustomFieldValues, CustomFieldWithValue } from '@liwan/contracts'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../CustomFieldRows.vue')

// The component is compiled for the client, as the browser gets it, with its helpers and the Nuxt auto-imports it
// reads replaced by small stand-ins: date formats print their input, a list joins with "+", t(key) answers the key.
const modules: Record<string, Record<string, unknown>> = {
  vue: Vue,
  '@liwan/ui/app/composables/calendarDate': {
    formatLiwanDate: (value: string) => `date:${value}`,
    formatLiwanDateTime: (value: string) => `datetime:${value}`,
  },
  '@/utils/meetingDateTime': {
    fromUtcDateTimeInput: (value: string | null) => value ?? '',
    toUtcDateTime: (value: string) => value || undefined,
  },
  '@/utils/listFormat': { joinList: (items: string[]) => items.join('+') },
}

function loadComponent() {
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const compiled = compileScript(descriptor, {
    id: 'custom-field-rows',
    inlineTemplate: true,
    templateOptions: { compilerOptions: { expressionPlugins: ['typescript'] } },
  })
  const js = ts.transpileModule(compiled.content, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  const body = js
    .replace(/import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?/g, (_, names: string, from: string) =>
      `const {${names.replace(/ as /g, ': ')}} = __modules['${from}'];`)
    .replace('export default', 'return')
  const factory = new Function('__modules', 'computed', 'ref', 'watch', 'useHydrated', 'useI18n', body)
  return factory(modules, Vue.computed, Vue.ref, Vue.watch, () => Vue.ref(true), () => ({ t: (key: string) => key })) as Vue.Component
}

const CustomFieldRows = loadComponent()

// The property row prints its label and value; every control keeps what the rows pass it, update handler included.
const PropertyRow = defineComponent({
  props: { label: String, value: { type: [String, Number], default: null } },
  setup: (props, { slots }) => () => h('row', { label: props.label, value: props.value }, slots.default?.()),
})
const Control = defineComponent({ inheritAttrs: false, setup: (_, { attrs }) => () => h('control', attrs) })
const STUBS = { SharedPropertyRow: PropertyRow, UInput: Control, UTextarea: Control, UInputNumber: Control, USwitch: Control, SharedDateField: Control, USelect: Control, USelectMenu: Control }

interface FakeNode { type: string; props: Record<string, unknown>; children: FakeNode[] }

function mountRows(initial: { fields: CustomFieldWithValue[]; editable: boolean; disabled?: boolean }) {
  const state = reactive({ ...initial })
  const emitted = { dirty: [] as boolean[], change: [] as CustomFieldValues[] }
  const { createApp } = createRenderer<FakeNode, FakeNode>({
    createElement: type => ({ type, props: {}, children: [] }),
    createText: () => ({ type: '#text', props: {}, children: [] }),
    createComment: () => ({ type: '#comment', props: {}, children: [] }),
    setText: () => {},
    setElementText: () => {},
    insert: (child, parent, anchor) => {
      const at = anchor ? parent.children.indexOf(anchor) : -1
      if (at < 0) parent.children.push(child)
      else parent.children.splice(at, 0, child)
    },
    remove: child => { if (child) child.type = '#removed' },
    parentNode: () => null,
    nextSibling: () => null,
    patchProp: (node, key, _prev, next) => { node.props[key] = next },
  })
  const root: FakeNode = { type: 'root', props: {}, children: [] }
  const app = createApp({
    render: () => h(CustomFieldRows, {
      fields: state.fields,
      editable: state.editable,
      disabled: state.disabled,
      'onUpdate:dirty': (dirty: boolean) => emitted.dirty.push(dirty),
      onChange: (values: CustomFieldValues) => emitted.change.push(values),
    }),
  })
  Object.entries(STUBS).forEach(([name, component]) => app.component(name, component))
  app.mount(root)

  const all = (node: FakeNode): FakeNode[] => [node, ...node.children.flatMap(all)].filter(item => item.type !== '#removed')
  const row = (label: string) => all(root).find(node => node.type === 'row' && node.props.label === label)
  const control = (label: string) => all(root).find(node => node.type === 'control' && node.props['aria-label'] === label)!
  const update = (label: string, value: unknown) => (control(label).props['onUpdate:modelValue'] as (value: unknown) => void)(value)
  return { state, emitted, row, control, update }
}

const fields: CustomFieldWithValue[] = [
  { key: 'a1', label: 'Note', type: 'char', value: null },
  { key: 'b2', label: 'Tier', type: 'selection', options: [{ key: 'o1', label: 'Gold' }, { key: 'o2', label: 'Silver' }], value: 'o1' },
  { key: 'c3', label: 'Interests', type: 'tags', options: [{ key: 'o1', label: 'Sea' }, { key: 'o2', label: 'Sky' }], value: ['o1', 'o2'] },
  { key: 'd4', label: 'VIP', type: 'boolean', value: true },
  { key: 'e5', label: 'Seats', type: 'integer', value: 4 },
  { key: 'f6', label: 'Since', type: 'date', value: '2026-01-02' },
]

describe('CustomFieldRows read mode', () => {
  it('prints selection and tags by their option labels, a boolean as yes/no and a date formatted', () => {
    const { row } = mountRows({ fields, editable: false })
    expect(row('Tier')?.props.value).toBe('Gold')
    expect(row('Interests')?.props.value).toBe('Sea+Sky')
    expect(row('VIP')?.props.value).toBe('customFields.yes')
    expect(row('Seats')?.props.value).toBe('4')
    expect(row('Since')?.props.value).toBe('date:2026-01-02')
  })

  it('prints false as no and an empty value or empty tags list as nothing', () => {
    const { row } = mountRows({
      fields: [
        { key: 'd4', label: 'VIP', type: 'boolean', value: false },
        { key: 'a1', label: 'Note', type: 'char', value: null },
        { key: 'c3', label: 'Interests', type: 'tags', options: [{ key: 'o1', label: 'Sea' }], value: [] },
      ],
      editable: false,
    })
    expect(row('VIP')?.props.value).toBe('customFields.no')
    expect(row('Note')?.props.value).toBeNull()
    expect(row('Interests')?.props.value).toBeNull()
  })

  it('shows no input while the rows are read-only', () => {
    expect(mountRows({ fields, editable: false }).control('Seats')).toBeUndefined()
  })
})

describe('CustomFieldRows edit mode', () => {
  it('reports only the changed keys and the dirty flag', () => {
    const { emitted, update } = mountRows({ fields, editable: true })

    update('Seats', 6)
    expect(emitted.change.at(-1)).toEqual({ e5: 6 })
    expect(emitted.dirty.at(-1)).toBe(true)

    update('Tier', '__none__')
    expect(emitted.change.at(-1)).toEqual({ e5: 6, b2: null })

    update('Seats', 4)
    expect(emitted.change.at(-1)).toEqual({ b2: null })

    update('Tier', 'o1')
    expect(emitted.change.at(-1)).toEqual({})
    expect(emitted.dirty.at(-1)).toBe(false)
  })

  it('rounds a whole-number field and sends an emptied text field as null', () => {
    const { emitted, update } = mountRows({ fields, editable: true })
    update('Seats', 6.4)
    expect(emitted.change.at(-1)).toEqual({ e5: 6 })
    update('Note', 'hello')
    expect(emitted.change.at(-1)).toEqual({ e5: 6, a1: 'hello' })
    update('Note', '')
    expect(emitted.change.at(-1)).toEqual({ e5: 6 })
  })

  it('resets the draft and the dirty flag when the fields prop changes', async () => {
    const { state, emitted, update, control } = mountRows({ fields, editable: true })
    update('Seats', 9)
    expect(emitted.dirty.at(-1)).toBe(true)

    state.fields = fields.map(field => (field.key === 'e5' ? { ...field, value: 9 } : field))
    await nextTick()
    expect(emitted.dirty.at(-1)).toBe(false)
    expect(control('Seats').props['model-value']).toBe(9)
  })

  it('keeps a value the reader cleared empty instead of showing the saved one', async () => {
    const { update, control } = mountRows({ fields, editable: true })
    update('Tier', '__none__')
    update('Seats', null)
    await nextTick()
    expect(control('Tier').props['model-value']).toBe('__none__')
    expect(control('Seats').props['model-value']).toBeNull()
  })

  it('holds every control still while disabled', () => {
    const { control } = mountRows({ fields, editable: true, disabled: true })
    for (const label of ['Note', 'Tier', 'Interests', 'VIP', 'Seats', 'Since']) expect(control(label).props.disabled).toBe(true)
  })
})
