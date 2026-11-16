import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as quote from '../../../composables/sales/salesQuote'
import { vueBindings } from '../../../../tests/vueBindings'

// The pad compiled from its SFC and mounted on a minimal in-memory renderer (the tests run without a DOM), with a canvas
// that records what is drawn. Only the behaviour of the pad is under test: the keyboard route to a signature.
type Node = { type: string; props: Record<string, unknown>; children: Node[]; text?: string; parent?: Node }
type Canvas = Node & { getContext: () => unknown; toDataURL: () => string }

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg'
const drawn: Array<[string, ...unknown[]]> = []

function compile() {
  const filename = resolve(import.meta.dirname, '../SalesSignaturePad.vue')
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
  const script = compileScript(descriptor, { id: 'pad', inlineTemplate: true }).content
    .replace(/^import\s*\{([^}]*)\}\s*from\s*['"]vue['"];?\s*$/gm, (_, names: string) => `const {${names.replace(/ as /g, ': ')}} = Vue`)
    .replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
  return ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText
}

const context = {
  clearRect: (...args: unknown[]) => drawn.push(['clear', ...args]),
  measureText: () => ({ width: 100 }),
  fillText: (...args: unknown[]) => drawn.push(['fillText', ...args]),
  set font(value: string) { drawn.push(['font', value]) },
  set direction(value: string) { drawn.push(['direction', value]) },
  set fillStyle(value: string) { drawn.push(['fillStyle', value]) }, set strokeStyle(value: string) { drawn.push(['strokeStyle', value]) },
  set textAlign(_value: string) {}, set textBaseline(_value: string) {},
  beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => drawn.push(['stroke']),
  set lineWidth(_value: number) {}, set lineCap(_value: string) {}, set lineJoin(_value: string) {},
}

const renderer = Vue.createRenderer<Node, Node>({
  createElement: type => {
    const node: Node = { type, props: {}, children: [] }
    return type === 'canvas' ? Object.assign(node, { getContext: () => context, toDataURL: () => PNG, setPointerCapture: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 480, height: 160 }) }) : node
  },
  createText: text => ({ type: '#text', props: {}, children: [], text }),
  createComment: text => ({ type: '#comment', props: {}, children: [], text }),
  setText: (node, text) => { node.text = text },
  setElementText: (node, text) => { node.children = [{ type: '#text', props: {}, children: [], text, parent: node }] },
  insert: (child, parent, anchor) => { child.parent = parent; const at = anchor ? parent.children.indexOf(anchor) : -1; if (at < 0) parent.children.push(child); else parent.children.splice(at, 0, child) },
  remove: child => { child.parent?.children.splice(child.parent.children.indexOf(child), 1) },
  patchProp: (node, key, _old, value) => { node.props[key] = value },
  parentNode: node => node.parent ?? null,
  nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] ?? null,
})

const Button = Vue.defineComponent({ props: ['disabled', 'label'], setup: (props, { attrs }) => () => Vue.h('button', { ...attrs, disabled: props.disabled }, props.label) })

function mount(initial: { signerName?: string; disabled?: boolean; methods?: 'draw' | 'draw_or_type' }) {
  const emitted: Array<string | null> = []
  const methods: Array<string | null> = []
  const method = Vue.ref<string | null>(null)
  const props = Vue.reactive({ ...initial })
  const globals = { Vue, ...vueBindings, ...quote, INK: '#14102a', useI18n: () => ({ t: (key: string) => key }) }
  const pad = new Function(...Object.keys(globals), compile())(...Object.values(globals))
  const app = renderer.createApp({ render: () => Vue.h(pad, { ...props, modelValue: current.value, 'onUpdate:modelValue': (value: string | null) => { current.value = value; emitted.push(value) }, method: method.value, 'onUpdate:method': (value: string | null) => { method.value = value; methods.push(value) } }) })
  const current = Vue.ref<string | null>(null)
  app.component('UButton', Button)
  const root: Node = { type: 'root', props: {}, children: [] }
  app.mount(root)
  const find = (testid: string, from: Node = root): Node | undefined => from.props['data-testid'] === testid ? from : from.children.map(child => find(testid, child)).find(Boolean)
  return { emitted, methods, find, props, state: () => find('quote-signature-state')!.children.map(child => child.text).join('') }
}

afterEach(() => { drawn.length = 0; vi.unstubAllGlobals() })

describe('SalesSignaturePad keyboard route', () => {
  it('has a typed-name button that stays disabled until a name is written, and names the box and its state for a screen reader', () => {
    const { find, state } = mount({ signerName: '   ' })
    expect(find('quote-signature-typed')!.props.disabled).toBe(true)
    expect(find('quote-signature-pad')!.props).toMatchObject({ role: 'img', 'aria-label': 'sales.quote.signatureLabel' })
    expect(find('quote-signature-state')!.props).toMatchObject({ role: 'status', 'aria-live': 'polite' })
    expect(state()).toBe('sales.quote.signatureEmpty')
  })

  it('writes the typed name onto the box and emits it as a base64 PNG without a data prefix', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    const { emitted, find, state } = mount({ signerName: ' منى العتيبي ' })
    const button = find('quote-signature-typed')!
    expect(button.props.disabled).toBe(false)
    await (button.props.onClick as () => Promise<void>)()
    await Vue.nextTick()
    expect(drawn).toContainEqual(['fillText', 'منى العتيبي', 240, 80, 432])
    expect(drawn).toContainEqual(['direction', 'rtl'])
    expect(emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg'])
    expect(state()).toBe('sales.quote.signatureSigned')
  })

  it('writes a Latin name left to right, and the clear button empties the box', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    const { emitted, find, state } = mount({ signerName: 'Mona' })
    await (find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    expect(drawn).toContainEqual(['direction', 'ltr'])
    ;(find('quote-signature-clear')!.props.onClick as () => void)()
    await Vue.nextTick()
    expect(emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg', null])
    expect(state()).toBe('sales.quote.signatureEmpty')
  })

  it('does nothing while the answer is being sent', async () => {
    const { emitted, find } = mount({ signerName: 'Mona', disabled: true })
    expect(find('quote-signature-typed')!.props.disabled).toBe(true)
    await (find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    expect(emitted).toEqual([])
  })

  it('draws and fills with the brand ink whatever the theme, so the picture is never light on white', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    // A dark theme paints the page's own text colour near white; the pad must not read it.
    vi.stubGlobal('getComputedStyle', () => ({ color: 'rgb(243, 243, 246)' }))
    const { find } = mount({ signerName: 'Mona' })
    await (find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    expect(drawn).toContainEqual(['strokeStyle', '#14102a'])
    expect(drawn).toContainEqual(['fillStyle', '#14102a'])
    expect(drawn.filter(([kind]) => kind === 'strokeStyle' || kind === 'fillStyle').every(([, value]) => value === '#14102a')).toBe(true)
  })

  it('removes a typed signature when the name is edited, but keeps a drawn one', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    const typed = mount({ signerName: 'Mona' })
    await (typed.find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    expect(typed.state()).toBe('sales.quote.signatureSigned')
    typed.props.signerName = 'Mona Q'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(typed.emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg', null])
    expect(typed.methods).toEqual(['typed', null])
    expect(typed.state()).toBe('sales.quote.signatureEmpty')

    const hand = mount({ signerName: 'Mona' })
    const pad = hand.find('quote-signature-pad')!.props
    ;(pad.onPointerdown as (event: unknown) => void)({ isPrimary: true, pointerType: 'touch', button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    ;(pad.onPointerup as () => void)()
    hand.props.signerName = 'Mona Q'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(hand.emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg'])
  })

  it('clears a typed signature when the sender turns to draw only, and keeps a drawn one', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    const typed = mount({ signerName: 'Mona' })
    await (typed.find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    typed.props.methods = 'draw'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(typed.emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg', null])
    expect(typed.methods).toEqual(['typed', null])
    expect(typed.state()).toBe('sales.quote.signatureEmpty')

    const hand = mount({ signerName: 'Mona' })
    const pad = hand.find('quote-signature-pad')!.props
    ;(pad.onPointerdown as (event: unknown) => void)({ isPrimary: true, pointerType: 'touch', button: 0, pointerId: 1, clientX: 10, clientY: 10 })
    ;(pad.onPointerup as () => void)()
    hand.props.methods = 'draw'
    await Vue.nextTick()
    await Vue.nextTick()
    expect(hand.emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg'])
    expect(hand.methods).toEqual(['drawn'])
  })

  it('drops a typed signature whose name changed while the font loaded', async () => {
    let release = () => {}
    vi.stubGlobal('document', { fonts: { load: () => new Promise<void>(resolve => { release = resolve }) } })
    const { emitted, find, props } = mount({ signerName: 'Mona' })
    const writing = (find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    props.signerName = 'Mona Q'
    release()
    await writing
    expect(emitted).toEqual([])
    expect(drawn.some(([kind]) => kind === 'fillText')).toBe(false)
  })

  it('starts a stroke only for the primary pointer and, for a mouse, the main button', () => {
    const { emitted, find } = mount({})
    const pad = find('quote-signature-pad')!.props
    const stroke = (event: Record<string, unknown>) => { (pad.onPointerdown as (event: unknown) => void)({ pointerId: 1, clientX: 5, clientY: 5, ...event }); (pad.onPointerup as () => void)() }
    stroke({ isPrimary: false, pointerType: 'touch', button: 0 })
    stroke({ isPrimary: true, pointerType: 'mouse', button: 2 })
    expect(emitted).toEqual([])
    stroke({ isPrimary: true, pointerType: 'mouse', button: 0 })
    expect(emitted).toEqual(['iVBORw0KGgoAAAANSUhEUg'])
  })

  it('says which method made the signature: typing after drawing and drawing after typing replace each other, clear resets', async () => {
    vi.stubGlobal('document', { fonts: { load: async () => [] } })
    const { methods, find } = mount({ signerName: 'Mona' })
    const stroke = () => {
      const pad = find('quote-signature-pad')!.props
      ;(pad.onPointerdown as (event: unknown) => void)({ isPrimary: true, pointerType: 'touch', button: 0, pointerId: 1, clientX: 10, clientY: 10 })
      ;(pad.onPointerup as () => void)()
    }
    stroke()
    await (find('quote-signature-typed')!.props.onClick as () => Promise<void>)()
    stroke()
    ;(find('quote-signature-clear')!.props.onClick as () => void)()
    await Vue.nextTick()
    expect(methods).toEqual(['drawn', 'typed', 'drawn', null])
  })

  it('keeps no typed-name button when only a drawn signature is accepted, and tells so in its hint', () => {
    const drawOnly = mount({ signerName: 'Mona', methods: 'draw' })
    expect(drawOnly.find('quote-signature-typed')).toBeUndefined()
    expect(drawOnly.find('quote-signature-clear')).toBeDefined()
    expect(JSON.stringify(drawOnly.find('quote-signature-pad')!.parent!.children.map(child => child.children.map(node => node.children.map(inner => inner.text))))).toContain('sales.quote.signatureHintDraw')
    expect(mount({ signerName: 'Mona' }).find('quote-signature-typed')).toBeDefined()
  })
})
