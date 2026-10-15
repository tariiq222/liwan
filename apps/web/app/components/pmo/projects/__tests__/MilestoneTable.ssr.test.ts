import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { describe, expect, it } from 'vitest'

const filename = new URL('../MilestoneTable.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const parsed = parse(source, { filename: filename.pathname })
if (!parsed.descriptor.template) throw new Error('no template')
const compiled = compileTemplate({
  source: parsed.descriptor.template.content,
  filename: filename.pathname,
  id: 'milestone-table-ssr',
  compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] },
})
const render = new Function('Vue', ts.transpileModule(compiled.code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText)(Vue) as RenderFunction

const Stub = defineComponent({
  inheritAttrs: false,
  setup(_, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  },
})

// Renders each row action as a button so the rendered contract (labels,
// destructive flag and disabled reason) can be asserted without Nuxt UI.
const RowActionsStub = defineComponent({
  props: { actions: { type: Array, required: true }, label: { type: String, required: true } },
  setup(props) {
    return () => h('div', { 'data-testid': 'row-actions', 'aria-label': props.label }, (props.actions as { label: string; destructive?: boolean; disabled?: boolean }[]).map(action =>
      h('button', { 'data-destructive': action.destructive ? 'true' : undefined, disabled: action.disabled }, action.label)))
  },
})

// Render the DataTable's named cell slots using its public row contract.
const DataTableStub = defineComponent({
  props: { rows: { type: Array, required: true } },
  setup(props, { slots }) {
    return () => h('table', [h('tbody', (props.rows as object[]).map(original => h('tr', [
      h('td', slots['name-cell']?.({ row: { original } })),
      h('td', slots['actions-cell']?.({ row: { original } })),
    ])))])
  },
})

describe('MilestoneTable SSR', () => {
  it('keeps a disabled, explained delete action for a milestone with linked tasks', async () => {
    const milestone = {
      id: 1,
      name: 'In use',
      start_date: null,
      deadline: null,
      deliverables: [],
      is_reached: false,
      done_task_count: 1,
      task_count: 2,
    }
    const items = computed(() => [milestone])
    const hydrated = ref(true)
    const bindings = {
      props: { projectId: 1, canManage: true },
      projectId: 1,
      canManage: true,
      items,
      isLoading: ref(false),
      hydrated,
      error: ref(null),
      refetch: () => {},
      locale: ref('en-US'),
      STATUS_COLOR: { success: 'success', neutral: 'neutral' },
      DEADLINE_TEXT_CLASS: { destructive: '', neutral: '' },
      t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${String(params.count)}` : key,
      deadlineTone: () => 'neutral',
      deadlineText: () => '—',
      startText: () => '—',
      taskProgress: () => 50,
      toggleReached: () => {},
      toggleDeliverable: () => {},
      isDeliverablePending: () => false,
      milestoneActions: (m: typeof milestone) => [
        { label: 'projects.milestones.markReached' },
        { label: 'projects.milestones.edit' },
        { label: m.task_count > 0 ? `projects.milestones.deleteBlocked:${m.task_count}` : 'projects.milestones.delete', destructive: true, disabled: m.task_count > 0 },
      ],
      deleteTarget: ref(null),
      deleting: ref(false),
      confirmDelete: () => {},
    }
    const app = createSSRApp(defineComponent({ setup: () => bindings, render }))
    for (const name of ['UCard', 'SharedPageState', 'USkeleton', 'UBadge', 'UButton', 'USwitch']) app.component(name, Stub)
    app.component('SharedDataTable', DataTableStub)
    app.component('SharedStatusBadge', Stub)
    app.component('SharedRowActions', RowActionsStub)
    app.component('SharedInlineConfirm', Stub)

    const html = await renderToString(app)
    expect(html).toContain('data-testid="milestone-row"')
    expect(html).toContain('data-testid="milestone-actions"')
    expect(html).toContain('aria-label="projects.milestones.actionsNamed:')
    expect(html).toMatch(/<button data-destructive="true" disabled[^>]*>projects\.milestones\.deleteBlocked:2<\/button>/)
    expect(html).not.toContain('milestone-delete-confirm')
  })
})
