import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRenderer, h, nextTick, ref, type Ref } from '@vue/runtime-core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFinanceIdentityGeneration, useFinanceSetupScope } from '../useFinanceSetup'

// A DOM-free renderer: only mounting and unmounting component instances matters here.
type Node = { children: Node[]; parent: Node | null }
const node = (): Node => ({ children: [], parent: null })
const { createApp } = createRenderer<Node, Node>({
  patchProp: () => undefined,
  insert: (child, parent, anchor) => { child.parent = parent; parent.children.splice(anchor ? parent.children.indexOf(anchor) : parent.children.length, 0, child) },
  remove: (child) => { if (child.parent) child.parent.children = child.parent.children.filter(c => c !== child) },
  createElement: node, createText: node, createComment: node,
  setText: () => undefined, setElementText: () => undefined,
  parentNode: child => child.parent, nextSibling: () => null,
})

type Me = { id: number; company: { id: number } } | null
const user = (id: number, company: number): Me => ({ id, company: { id: company } })
afterEach(() => vi.unstubAllGlobals())

describe('the observed-identity generation', () => {
  it('survives the unmount of the component whose setup created it, and stops only when its owner stops it', () => {
    const me = ref<Me>(null)
    let own!: ReturnType<typeof createFinanceIdentityGeneration>
    const app = createApp({ setup() { own = createFinanceIdentityGeneration(me); return () => h('i') } })
    app.mount(node())
    me.value = user(1, 1)
    me.value = null
    me.value = user(1, 1)
    expect(own.generation.value).toBe(3)
    app.unmount()
    me.value = user(2, 1)
    expect(own.generation.value).toBe(4)
    own.stop()
    me.value = user(3, 1)
    expect(own.generation.value).toBe(4)
  })

  it('keeps counting across consumer unmount and remount, without a consumer retaining it', async () => {
    const me: Ref<Me> = ref<Me>(null)
    const own = createFinanceIdentityGeneration(me)
    vi.stubGlobal('useMe', () => ({ me }))
    vi.stubGlobal('useNuxtApp', () => ({ $financeIdentityGeneration: own.generation }))
    const reads: Array<() => unknown> = []
    const consumer = { setup() { reads.push(() => useFinanceSetupScope().read()); return () => h('i') } }
    const mount = () => { const el = node(); const app = createApp(consumer); app.mount(el); return app }

    const first = mount()
    me.value = user(1, 1)
    expect(own.generation.value).toBe(1)
    first.unmount()
    me.value = null
    me.value = user(1, 1)
    expect(own.generation.value).toBe(3)
    const second = mount()
    await nextTick()
    me.value = user(2, 1)
    expect(own.generation.value).toBe(4)
    second.unmount()
    own.stop()
  })

  it('is owned by the Nuxt plugin, not by the composable a component calls', () => {
    const composable = readFileSync(resolve(import.meta.dirname, '../useFinanceSetup.ts'), 'utf8')
    expect(composable).not.toMatch(/useNuxtApp\(\)[\s\S]{0,80}WeakMap|WeakMap<object, Ref<number>>/)
    const plugin = readFileSync(resolve(import.meta.dirname, '../../../plugins/finance-identity.ts'), 'utf8')
    expect(plugin).toContain('createFinanceIdentityGeneration')
    expect(plugin).toContain('onUnmount(stop)')
    expect(plugin).toContain("hookOnce('app:rendered', stop)")
  })
})

describe('the fiscal summary heading', () => {
  const locale = (name: string) => JSON.parse(readFileSync(resolve(import.meta.dirname, `../../../../i18n/locales/${name}/finance.json`), 'utf8')).finance
  it.each([['en', 'Fix these fields before saving:'], ['ar', 'صحّح هذه الحقول قبل الحفظ:']])('is translated under finance.setup.fiscal (%s)', (name, text) => {
    expect(locale(name).setup.fiscal.errorSummary).toBe(text)
  })
})
