import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as callChipModule from '../../../packages/ui/app/composables/useCallChip'
import type {
  CallChipActions,
  CallChipLabels,
  CallChipSeam,
  CallChipState,
} from '../../../packages/ui/app/composables/useCallChip'
import { vueBindings } from './vueBindings'

type HostNode = {
  type: string
  text: string
  children: HostNode[]
  parent: HostNode | null
  props: Record<string, any>
}

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
  createElement: type => node(type),
  createText: text => node('text', text),
  createComment: () => node('comment', ''),
  setText: (el, text) => { el.text = text },
  setElementText: (el, text) => { el.text = text; el.children = [] },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
})

const allNodes = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(allNodes)]
const textOf = (root: HostNode): string => root.text + root.children.map(textOf).join('')
const byTestId = (root: HostNode, id: string) => allNodes(root).find(el => el.props['data-testid'] === id)

const filename = new URL('../../../packages/ui/app/components/shell/ShellCallChip.vue', import.meta.url).pathname
const compiled = ts.transpileModule(
  compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
    id: 'shell-call-chip',
    inlineTemplate: true,
  }).content,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  },
).outputText

function loadShellCallChip(hydratedValue: boolean): Vue.Component {
  const modules: Record<string, unknown> = {
    vue: Vue,
    '../../composables/useCallChip': callChipModule,
  }
  const req = (specifier: string) => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`ShellCallChip.vue imports unexpected module: ${specifier}`)
  }
  const globals = {
    ...vueBindings,
    useHydrated: () => Vue.ref(hydratedValue),
  }
  const exports: { default?: Vue.Component } = {}
  new Function('require', 'exports', ...Object.keys(globals), compiled)(req, exports, ...Object.values(globals))
  return exports.default!
}

const LABELS: CallChipLabels = {
  label: 'المكالمة',
  idle: 'الهاتف',
  ringing: number => `مكالمة من ${number}`,
  calling: number => `جارٍ الاتصال بـ ${number}`,
  inCall: duration => `في مكالمة ${duration}`,
  failed: 'تعذّرت المكالمة',
  failedHint: 'تحقق من الاتصال ثم أعد المحاولة',
  retry: 'إعادة المحاولة',
  noExtension: 'لا توجد تمثيلة مخصّصة لحسابك بعد.',
  callerCard: 'بطاقة المتصل',
  unknownCaller: 'متصل غير معروف',
  loadingCaller: 'جارٍ البحث عن المتصل…',
  recentCalls: 'آخر المكالمات',
  saveContact: 'حفظ جهة اتصال',
  answer: 'رد',
  reject: 'رفض',
  hangUp: 'إنهاء',
  mute: 'كتم',
  unmute: 'إلغاء الكتم',
  hold: 'تعليق',
  resume: 'استئناف',
  transfer: 'تحويل',
  transferPlaceholder: 'رقم أو تمثيلة للتحويل',
  transferSend: 'تحويل المكالمة',
  transferring: 'جارٍ التحويل…',
  keypad: 'لوحة الأرقام',
  dialpadTitle: 'إجراء مكالمة',
  dialPlaceholder: 'رقم الهاتف أو التمثيلة',
  dialCall: 'اتصال',
  backspace: 'حذف آخر رقم',
}

function makeState(overrides: Partial<CallChipState> = {}): CallChipState {
  return {
    phase: 'registered',
    remote: null,
    registeredAs: '1001',
    since: null,
    failure: null,
    hasExtension: true,
    isLeader: true,
    muted: false,
    held: false,
    transferring: false,
    transferError: null,
    callerCard: null,
    callerCardLoading: false,
    ...overrides,
  }
}

function makeActions(overrides: Partial<CallChipActions> = {}): CallChipActions {
  return {
    answer: vi.fn(),
    reject: vi.fn(),
    hangUp: vi.fn(),
    call: vi.fn(() => null),
    toggleMute: vi.fn(),
    toggleHold: vi.fn(),
    transfer: vi.fn(() => null),
    sendDtmf: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  }
}

function mountChip(seam: CallChipSeam | null, hydratedValue = true) {
  const ShellCallChip = loadShellCallChip(hydratedValue)

  const UPopover = Vue.defineComponent({
    props: ['open', 'content'],
    emits: ['update:open'],
    setup(_props, { slots }) {
      return () => Vue.h('div', { 'data-testid': 'popover' }, [
        slots.default?.(),
        Vue.h('div', { 'data-testid': 'popover-content' }, slots.content?.()),
      ])
    },
  })
  const UButton = Vue.defineComponent({
    props: ['color', 'variant', 'size', 'icon', 'disabled', 'loading'],
    setup(props, { slots, attrs }) {
      return () => Vue.h('button', {
        ...attrs,
        disabled: props.disabled,
        'data-color': props.color,
        'data-icon': props.icon,
      }, slots.default?.())
    },
  })
  const UInput = Vue.defineComponent({
    props: ['modelValue', 'disabled', 'placeholder', 'dir'],
    emits: ['update:modelValue'],
    setup(props, { emit, attrs }) {
      return () => Vue.h('input', {
        ...attrs,
        value: props.modelValue,
        disabled: props.disabled,
        dir: props.dir,
        onInput: (value: string) => emit('update:modelValue', value),
      })
    },
  })
  const UIcon = Vue.defineComponent({
    props: ['name'],
    setup(props) { return () => Vue.h('span', { 'data-icon': props.name }) },
  })
  const NuxtLink = Vue.defineComponent({
    props: ['to'],
    setup(props, { slots, attrs }) {
      return () => Vue.h('a', { ...attrs, href: typeof props.to === 'string' ? props.to : '' }, slots.default?.())
    },
  })

  const errors: unknown[] = []
  const app = renderer.createApp({
    setup() {
      if (seam !== null) callChipModule.provideCallChip(seam)
      return () => Vue.h(ShellCallChip)
    },
  })
  app.config.errorHandler = (err) => { errors.push(err) }
  app.component('UPopover', UPopover)
  app.component('UButton', UButton)
  app.component('UInput', UInput)
  app.component('UIcon', UIcon)
  app.component('NuxtLink', NuxtLink)

  const root = node()
  app.mount(root)
  return { app, root, errors }
}

describe('ShellCallChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when no CALL_CHIP seam is provided', () => {
    const mounted = mountChip(null)
    expect(mounted.errors).toEqual([])
    expect(byTestId(mounted.root, 'telephony-call-chip')).toBeUndefined()
    expect(textOf(mounted.root)).toBe('')
    mounted.app.unmount()
  })

  it('renders direct Answer and Reject buttons on the chip when ringing', () => {
    const actions = makeActions()
    const state = Vue.ref(makeState({
      phase: 'ringing',
      remote: '+966501234567',
      callerCard: {
        partnerName: 'سارة العتيبي',
        companyName: 'الرواد',
        number: '+966501234567',
        recentCalls: [{ id: 1, direction: 'واردة', state: 'تم الرد', time: '10:00', duration: '2:10' }],
        saveContactTo: null,
      },
    }))
    const mounted = mountChip({ state, actions, labels: LABELS })
    expect(mounted.errors).toEqual([])

    const trigger = byTestId(mounted.root, 'telephony-call-chip')!
    expect(trigger.props['data-phase']).toBe('ringing')
    expect(textOf(trigger)).toContain('سارة العتيبي')

    const answerBtn = byTestId(mounted.root, 'telephony-chip-answer')!
    const rejectBtn = byTestId(mounted.root, 'telephony-chip-reject')!
    expect(textOf(answerBtn)).toContain('رد')
    expect(textOf(rejectBtn)).toContain('رفض')

    const stopPropagation = vi.fn()
    answerBtn.props.onClick({ stopPropagation })
    expect(actions.answer).toHaveBeenCalledTimes(1)
    rejectBtn.props.onClick({ stopPropagation })
    expect(actions.reject).toHaveBeenCalledTimes(1)

    expect(textOf(byTestId(mounted.root, 'telephony-caller-company')!)).toContain('الرواد')
    expect(textOf(byTestId(mounted.root, 'telephony-recent-calls')!)).toContain('2:10')
    expect(byTestId(mounted.root, 'telephony-save-contact')).toBeUndefined()
    mounted.app.unmount()
  })

  it('renders direct Hang-up button, live tabular duration, and in-call mute/hold/transfer/DTMF controls', async () => {
    vi.setSystemTime(new Date('2026-11-27T12:00:00Z'))
    const actions = makeActions({
      transfer: vi.fn((target: string) => (target === 'bad' ? 'رقم غير صالح' : null)),
    })
    const state = Vue.ref(makeState({
      phase: 'in-call',
      remote: '+966501234567',
      since: Date.now() - 65_000,
    }))
    const mounted = mountChip({ state, actions, labels: LABELS })
    expect(mounted.errors).toEqual([])

    expect(textOf(byTestId(mounted.root, 'telephony-chip-duration')!)).toBe('1:05')
    await vi.advanceTimersByTimeAsync(2_000)
    await Vue.nextTick()
    expect(textOf(byTestId(mounted.root, 'telephony-chip-duration')!)).toBe('1:07')

    // Mute and Hold
    byTestId(mounted.root, 'telephony-mute')!.props.onClick()
    expect(actions.toggleMute).toHaveBeenCalledTimes(1)
    byTestId(mounted.root, 'telephony-hold')!.props.onClick()
    expect(actions.toggleHold).toHaveBeenCalledTimes(1)

    // Blind Transfer with validation feedback
    byTestId(mounted.root, 'telephony-transfer-toggle')!.props.onClick()
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-transfer-input')!.props.onInput('bad')
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-transfer-submit')!.props.onClick()
    await Vue.nextTick()
    expect(textOf(byTestId(mounted.root, 'telephony-transfer-error')!)).toBe('رقم غير صالح')

    byTestId(mounted.root, 'telephony-transfer-input')!.props.onInput('1002')
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-transfer-submit')!.props.onClick()
    await Vue.nextTick()
    expect(actions.transfer).toHaveBeenLastCalledWith('1002')

    // DTMF keypad
    byTestId(mounted.root, 'telephony-dtmf-toggle')!.props.onClick()
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-dtmf-5')!.props.onClick()
    byTestId(mounted.root, 'telephony-dtmf-#')!.props.onClick()
    expect(actions.sendDtmf).toHaveBeenNthCalledWith(1, '5')
    expect(actions.sendDtmf).toHaveBeenNthCalledWith(2, '#')

    // Direct Hang-up on chip
    byTestId(mounted.root, 'telephony-chip-hangup')!.props.onClick({ stopPropagation: vi.fn() })
    expect(actions.hangUp).toHaveBeenCalledTimes(1)

    mounted.app.unmount()
  })

  it('shows save-contact NuxtLink for unknown callers when saveContactTo is provided', () => {
    const state = Vue.ref(makeState({
      phase: 'ringing',
      remote: '+966559876543',
      callerCard: {
        partnerName: null,
        companyName: null,
        number: '+966559876543',
        recentCalls: [],
        saveContactTo: '/customers/new?phone=%2B966559876543&returnTo=%2Fcalls',
      },
    }))
    const mounted = mountChip({ state, actions: makeActions(), labels: LABELS })
    const link = byTestId(mounted.root, 'telephony-save-contact')!
    expect(link.props.href).toBe('/customers/new?phone=%2B966559876543&returnTo=%2Fcalls')
    expect(textOf(link)).toContain('حفظ جهة اتصال')
    mounted.app.unmount()
  })

  it('renders dialpad when idle with extension and validates input before calling', async () => {
    const actions = makeActions({
      call: vi.fn((number: string) => (number === '1' ? 'رقم غير صالح' : null)),
    })
    const state = Vue.ref(makeState({ phase: 'registered', hasExtension: true }))
    const mounted = mountChip({ state, actions, labels: LABELS })

    expect(byTestId(mounted.root, 'telephony-dialpad')).toBeTruthy()
    byTestId(mounted.root, 'telephony-dial-key-1')!.props.onClick()
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-dial-submit')!.props.onClick()
    await Vue.nextTick()
    expect(textOf(byTestId(mounted.root, 'telephony-dial-error')!)).toBe('رقم غير صالح')

    byTestId(mounted.root, 'telephony-dial-key-0')!.props.onClick()
    byTestId(mounted.root, 'telephony-dial-key-0')!.props.onClick()
    byTestId(mounted.root, 'telephony-dial-key-2')!.props.onClick()
    await Vue.nextTick()
    byTestId(mounted.root, 'telephony-dial-submit')!.props.onClick()
    await Vue.nextTick()
    expect(actions.call).toHaveBeenLastCalledWith('1002')
    expect(byTestId(mounted.root, 'telephony-dial-error')).toBeUndefined()
    mounted.app.unmount()
  })

  it('shows quiet no-extension notice when hasExtension is false, and Retry button when failed', () => {
    const noExt = mountChip({ state: Vue.ref(makeState({ phase: 'idle', hasExtension: false })), actions: makeActions(), labels: LABELS })
    expect(byTestId(noExt.root, 'telephony-no-extension')).toBeTruthy()
    expect(byTestId(noExt.root, 'telephony-dialpad')).toBeUndefined()
    noExt.app.unmount()

    const actions = makeActions()
    const failed = mountChip({ state: Vue.ref(makeState({ phase: 'failed', failure: 'timeout' })), actions, labels: LABELS })
    byTestId(failed.root, 'telephony-retry')!.props.onClick()
    expect(actions.retry).toHaveBeenCalledTimes(1)
    failed.app.unmount()
  })
})
