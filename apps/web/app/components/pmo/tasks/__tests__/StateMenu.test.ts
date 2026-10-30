import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import type { Task } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'
import { STATE_LABEL_KEY } from '../../../../composables/taskState'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../StateMenu.vue')
const source = readFileSync(filename, 'utf8')

const Passthrough = defineComponent({
  inheritAttrs: false,
  setup(_, { slots, attrs }) {
    return () => h('div', attrs, slots.default?.())
  },
})

type MenuItem = { label: string; onSelect: () => void }

const DropdownMenuStub = defineComponent({
  inheritAttrs: false,
  props: { items: { type: Array as () => MenuItem[], default: () => [] } },
  setup(props, { slots, attrs }) {
    return () => h('div', attrs, [
      slots.default?.(),
      ...props.items.map((item) => h('button', { type: 'button', onClick: item.onSelect }, item.label)),
    ])
  },
})

function loadStateMenu() {
  const parsed = parse(source, { filename })
  if (parsed.errors.length) throw parsed.errors[0]
  if (!parsed.descriptor.template) throw new Error('StateMenu.vue has no template')
  const compiled = compileTemplate({
    source: parsed.descriptor.template.content,
    filename,
    id: 'state-menu',
    compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
  })
  if (compiled.errors.length) throw compiled.errors[0]
  const runnableCode = ts.transpileModule(compiled.code, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText
  const render = new Function('Vue', runnableCode)(Vue) as RenderFunction
  return defineComponent({
    props: { task: { type: Object, required: true }, canApprove: { type: Boolean, default: false } },
    setup(props) {
      const states = computed(() => (props.task as Task).allowed_transitions ?? [])
      const hydrated = true
      const isPending = false
      const t = (key: string) => key
      const onSelect = (state: string) => state
      const items = computed(() => states.value.map((s) => ({ label: t(STATE_LABEL_KEY[s]), onSelect: () => onSelect(s) })))
      const stateBadge = (state: string) => ({ tone: 'info', label: state })
      const statusPillAttrs = (tone: string) => ({ class: 'liwan-pill', 'data-tone': tone })
      return { states, hydrated, isPending, t, onSelect, STATE_LABEL_KEY, items, stateBadge, statusPillAttrs }
    },
    render,
  })
}

async function renderMenu(task: Pick<Task, 'state' | 'allowed_transitions'>, canApprove = false) {
  const app = createSSRApp({
    render: () => h(loadStateMenu(), { task: { ...task, id: 1 }, canApprove }),
  })
  app.component('SharedStatusBadge', defineComponent({
    props: { tone: String, label: String },
    setup(props) { return () => h('span', { 'data-tone': props.tone }, props.label) },
  }))
  app.component('UDropdownMenu', DropdownMenuStub)
  app.component('Loader2', defineComponent({ setup: () => () => null }))
  return renderToString(app)
}

describe('StateMenu production template uses server allowed_transitions', () => {

  it('omits done for list and detail when the server did not offer it, even if canApprove is true', async () => {
    const html = await renderMenu({ state: 'in_progress', allowed_transitions: ['waiting', 'cancelled'] }, true)
    expect(html).toContain('tasks.state.waiting')
    expect(html).toContain('tasks.state.cancelled')
    expect(html).not.toContain('tasks.state.done')
  })

  it('keeps done when the server offered it, including none-mode users without canApprove', async () => {
    const html = await renderMenu({ state: 'in_progress', allowed_transitions: ['waiting', 'done', 'cancelled'] }, false)
    expect(html).toContain('tasks.state.done')
    expect(html).toContain('tasks.state.waiting')
  })
})
