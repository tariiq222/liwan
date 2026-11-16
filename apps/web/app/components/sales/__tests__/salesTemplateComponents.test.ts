import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import * as Vue from 'vue'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
import { SalesAnswerModeSchema, SalesAnsweredResendSchema, SalesPresetKeySchema, SalesSignatureMethodsSchema, SalesVisibilitySchema } from '@liwan/contracts'
import { SALES_PRESET_LABEL_KEYS, salesPresetValueLabel } from '../../../composables/sales/salesPresetPreview'
import ar from '../../../../i18n/locales/ar/sales.json'
import en from '../../../../i18n/locales/en/sales.json'

const badge = Vue.defineComponent({ inheritAttrs: false, props: ['label', 'tone'], setup: (props, { attrs }) => () => Vue.h('span', { 'data-badge': props.label, 'data-testid': attrs['data-testid'] }) })
const render = (props: Record<string, unknown>) => renderShared(resolve(import.meta.dirname, '../SalesTemplateLines.vue'), props, {}, {
  hydrated: true,
  messages: { 'sales.lines.empty': 'لا بنود', 'sales.templates.lineUnusable': 'المنتج غير متاح' },
  stubs: { SharedStatusBadge: badge },
})

const lines = [
  { kind: 'section', product: null, name: 'النطاق', quantity: 0, usable: true },
  { kind: 'product', product: { id: 9, name: 'مراجعة' }, name: '', quantity: 2, usable: true },
  { kind: 'product', product: { id: 10, name: 'منتج قديم' }, name: 'وصف', quantity: 1, usable: false },
  { kind: 'note', product: null, name: 'التسليم خلال أسبوع', quantity: 0, usable: true },
]

describe('SalesTemplateLines', () => {
  it('shows a section, a product with its quantity and a note in order, and marks a product that is gone', async () => {
    const html = await render({ lines })
    const order = ['النطاق', 'مراجعة', 'منتج قديم', 'التسليم خلال أسبوع'].map(text => html.indexOf(text))
    expect(order.every(index => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('× 2')
    expect(html.match(/data-badge="المنتج غير متاح"/g)).toHaveLength(1)
    expect(html).toContain('data-testid="sales-template-line-unusable"')
  })

  it('says so when there are no lines', async () => {
    expect(await render({ lines: [] })).toContain('لا بنود')
  })
})

const at = (tree: unknown, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree)
const missing = (tree: Record<string, unknown>, locale: string, paths: string[]) => paths.filter(path => typeof at(tree, path) !== 'string' || at(tree, path) === '').map(path => `${locale}: ${path}`)

describe('the template and preset strings', () => {
  it('names every preset, every setting a preset holds and every option it can set, in both languages', () => {
    const presets = SalesPresetKeySchema.options.flatMap(key => [`settings.presets.${key}`, `settings.presets.${key}Hint`])
    const labels = Object.values(SALES_PRESET_LABEL_KEYS).map(key => key.replace(/^sales\./, ''))
    const options = [
      ...SalesVisibilitySchema.options.map(value => `settings.visibility.${value}`),
      ...SalesAnswerModeSchema.options.map(value => `settings.quotations.answer.${value}`),
      ...SalesAnsweredResendSchema.options.map(value => `settings.quotations.resend.${value}`),
      ...SalesSignatureMethodsSchema.options.map(value => `settings.quotations.signature.${value}`),
    ]
    const paths = [...presets, ...labels, ...options]
    expect([...missing(ar.sales, 'ar', paths), ...missing(en.sales, 'en', paths)]).toEqual([])
    const t = (key: string) => key
    expect(salesPresetValueLabel('visibility', 'own', t)).toBe('sales.settings.visibility.own')
  })

  it('has a word for every part of the template pages, in both languages', () => {
    const names = ['title', 'new', 'edit', 'recordTitle', 'empty', 'search', 'archivedOnly', 'archived', 'ready', 'needsAttention', 'footer', 'lineCount', 'days', 'settingsValidity', 'lineUnusable', 'unusableTitle', 'unusable', 'archive', 'restore', 'archiveConfirm', 'archiveHint', 'archivedNotEditable', 'actionError']
    const paths = [
      ...names.map(name => `templates.${name}`),
      ...['name', 'lines', 'validity', 'state'].map(name => `templates.columns.${name}`),
      ...['header', 'headerHint', 'name', 'nameRequired', 'validityDays', 'validityDaysHint', 'validityDaysInvalid', 'terms', 'termsHint', 'lines', 'linesHint', 'create', 'saveError'].map(name => `templates.form.${name}`),
      ...['label', 'none', 'hint', 'chosen', 'linesFromTemplate'].map(name => `templates.picker.${name}`),
      'errors.templateUnusable',
      'errors.templateUnusableProduct',
    ]
    expect([...missing(ar.sales, 'ar', paths), ...missing(en.sales, 'en', paths)]).toEqual([])
  })

  it('uses no em dash and has the six plural forms Arabic needs', () => {
    for (const tree of [ar.sales.templates, en.sales.templates, ar.sales.settings.presets, en.sales.settings.presets]) expect(JSON.stringify(tree)).not.toContain('—')
    for (const key of ['lineCount', 'days', 'footer'] as const) expect(ar.sales.templates[key].split('|')).toHaveLength(6)
    expect(ar.sales.settings.presets.preview.split('|')).toHaveLength(6)
  })
})
