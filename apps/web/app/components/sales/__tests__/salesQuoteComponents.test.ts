import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import { SALES_LIMITS, type SalesCustomerAnswer, type SalesPublicQuotation } from '@liwan/contracts'
import * as quote from '../../../composables/sales/salesQuote'
import { vueBindings } from '../../../../tests/vueBindings'

// The compiled component with its script's imports supplied by name, so it runs without Nuxt's auto-imports.
function compile(file: string, inline: boolean) {
  const filename = resolve(import.meta.dirname, `../${file}`)
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: file, inlineTemplate: inline }).content
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?\s*$/gm, (_, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  return ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
}

const hydrated = Vue.ref(true)
const globals = {
  Vue, ...vueBindings, ...quote, SALES_LIMITS,
  useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }),
  useHydrated: () => hydrated,
  formatDate: (value: string) => value.slice(0, 10),
  SalesSignaturePad: Vue.defineComponent({ name: 'SalesSignaturePad', props: ['modelValue', 'disabled'], setup: () => () => Vue.h('canvas') }),
}

function stubs(app: Vue.App) {
  const passthrough = (name: string) => Vue.defineComponent({ name, inheritAttrs: true, setup: (_, { slots }) => () => Vue.h('div', { 'data-stub': name }, [slots.default?.(), slots.description?.()]) })
  const alert = Vue.defineComponent({ props: ['title'], setup: (props, { attrs, slots }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'] }, [props.title, slots.description?.()]) })
  app.component('UAlert', alert)
  for (const name of ['SharedPropertiesPanel', 'SharedPropertyRow', 'SharedStatusBadge']) app.component(name, passthrough(name))
  return app
}

const QUOTE: SalesPublicQuotation = {
  id: 7, number: 'S00007', state: 'sent', expired: false, company_name: 'Liwan', customer_name: 'Acme', date: '2026-11-14T08:00:00Z', validity_date: '2026-12-14', terms: '',
  currency: { id: 2, name: 'SAR', symbol: 'ر.س' }, amount_untaxed: 0, amount_tax: 0, amount_total: 0, lines: [],
  answer_mode: 'accept', answer: null, answered_at: null, signed_by: null, can_accept: true, can_decline: true,
}

async function renderStatus(fields: Partial<SalesPublicQuotation>) {
  const component = new Function(...Object.keys(globals), compile('SalesQuoteStatus.vue', true))(...Object.values(globals))
  return renderToString(stubs(Vue.createSSRApp(component, { quote: { ...QUOTE, ...fields } })))
}

describe('SalesQuoteStatus', () => {
  it('draws nothing while the quotation is open', async () => {
    expect(await renderStatus({})).not.toContain('data-testid')
  })

  it('says what became of a quotation the customer cannot answer', async () => {
    expect(await renderStatus({ expired: true, can_accept: false, can_decline: false })).toContain('sales.quote.states.expired.title')
    expect(await renderStatus({ state: 'cancelled' })).toContain('data-testid="quote-cancelled"')
    expect(await renderStatus({ state: 'confirmed', can_accept: false, can_decline: false })).toContain('sales.quote.states.confirmed.body')
    expect(await renderStatus({ answer_mode: 'none', can_accept: false, can_decline: false })).toContain('data-testid="quote-notOffered"')
  })

  it('shows who signed and when, and says so when acceptance already confirmed the order', async () => {
    const accepted = await renderStatus({ answer: 'accepted', signed_by: 'Mona', answered_at: '2026-11-15T10:00:00Z', can_accept: false, can_decline: false })
    expect(accepted).toContain('sales.quote.states.accepted.title')
    expect(accepted).toContain('sales.quote.signedBy Mona')
    expect(accepted).toContain('sales.quote.answeredOn 2026-11-15')
    expect(await renderStatus({ answer: 'accepted', state: 'confirmed', can_accept: false, can_decline: false })).toContain('sales.quote.states.acceptedConfirmed.body')
    const declined = await renderStatus({ answer: 'declined', answered_at: '2026-11-15T10:00:00Z', can_accept: false, can_decline: false })
    expect(declined).toContain('data-testid="quote-declined"')
    expect(declined).not.toContain('quote-signed-by')
  })
})

async function renderCustomerAnswer(answer: SalesCustomerAnswer) {
  const component = new Function(...Object.keys(globals), compile('SalesCustomerAnswer.vue', true))(...Object.values(globals))
  const app = stubs(Vue.createSSRApp(component, { answer }))
  app.component('SharedPropertyRow', Vue.defineComponent({ props: ['label', 'value'], setup: (props, { slots, attrs }) => () => Vue.h('div', { 'data-testid': attrs['data-testid'] }, [props.label, props.value, slots.default?.()]) }))
  return renderToString(app)
}

const WAITING: SalesCustomerAnswer = { mode: 'accept_and_sign', acceptance_confirms: true, answer: null, answered_at: null, signed_by: null, decline_reason: null }

describe('SalesCustomerAnswer', () => {
  it('shows a quotation still waiting with how the customer may answer and what acceptance does', async () => {
    const html = await renderCustomerAnswer(WAITING)
    expect(html).toContain('sales.answer.waiting')
    expect(html).toContain('sales.answer.modes.accept_and_sign')
    expect(html).toContain('sales.answer.orderConfirmed')
    expect(html).not.toContain('sales-answer-at')
    expect(await renderCustomerAnswer({ ...WAITING, acceptance_confirms: false })).toContain('sales.answer.youConfirm')
  })

  it('shows an acceptance with its signer and time, and a decline with its reason or a note that none was given', async () => {
    const accepted = await renderCustomerAnswer({ ...WAITING, answer: 'accepted', answered_at: '2026-11-15T10:00:00Z', signed_by: 'Mona' })
    expect(accepted).toContain('sales.answer.accepted')
    expect(accepted).toContain('sales-answer-signer')
    expect(accepted).toContain('2026-11-15')
    expect(accepted).not.toContain('sales.answer.afterAcceptance')
    expect(accepted).not.toContain('sales-answer-reason')
    const declined = await renderCustomerAnswer({ ...WAITING, answer: 'declined', answered_at: '2026-11-15T10:00:00Z', decline_reason: 'Too high' })
    expect(declined).toContain('sales.answer.declined')
    expect(declined).toContain('Too high')
    expect(await renderCustomerAnswer({ ...WAITING, answer: 'declined', answered_at: '2026-11-15T10:00:00Z' })).toContain('sales.answer.noReason')
  })
})

function answerForm(fields: Partial<SalesPublicQuotation> = {}, pending: 'accept' | 'decline' | null = null) {
  const component = new Function(...Object.keys(globals), compile('SalesQuoteAnswer.vue', false))(...Object.values(globals))
  const emitted: [string, unknown][] = []
  const state = component.setup({ quote: { ...QUOTE, ...fields }, pending, error: null }, { expose: () => {}, emit: (name: string, payload: unknown) => emitted.push([name, payload]) })
  return { state, emitted }
}

describe('SalesQuoteAnswer', () => {
  it('accepts at once when no signature is asked for', () => {
    const { state, emitted } = answerForm()
    state.accept()
    expect(emitted).toEqual([['accept', {}]])
  })

  it('asks for the name and the signature before it accepts, and says which is missing', async () => {
    const { state, emitted } = answerForm({ answer_mode: 'accept_and_sign' })
    state.accept()
    await Vue.nextTick()
    expect(emitted).toEqual([])
    expect(state.nameError.value).toBe('sales.quote.signedByRequired')
    expect(state.signatureError.value).toBe('sales.quote.signatureRequired')
    state.signedBy.value = '  Mona  '
    state.signature.value = btoa('a'.repeat(48 * 1024 + 1))
    expect(state.nameError.value).toBeUndefined()
    expect(state.signatureError.value).toBe('sales.quote.signatureTooLarge')
    state.accept()
    expect(emitted).toEqual([])
    state.signature.value = 'iVBORw0KGgo='
    expect(state.signatureError.value).toBeUndefined()
    state.accept()
    expect(emitted).toEqual([['accept', { signedBy: 'Mona', signature: 'iVBORw0KGgo=' }]])
  })

  it('does nothing while an answer is being sent or before the page is live', () => {
    const { state, emitted } = answerForm({}, 'decline')
    state.accept()
    expect(emitted).toEqual([])
    hydrated.value = false
    const early = answerForm()
    early.state.accept()
    expect(early.emitted).toEqual([])
    hydrated.value = true
  })

  it('declines with the trimmed reason, or none when it is blank', () => {
    const { state, emitted } = answerForm()
    state.reason.value = '  Too high  '
    state.decline()
    state.reason.value = '   '
    state.decline()
    expect(emitted).toEqual([['decline', 'Too high'], ['decline', undefined]])
  })
})
