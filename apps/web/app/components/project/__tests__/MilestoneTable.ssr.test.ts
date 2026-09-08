import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
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

describe('MilestoneTable SSR', () => {
  it('renders an occupied milestone tooltip with its provider context', async () => {
    const milestone = {
      id: 1,
      name: 'In use',
      deadline: null,
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
      STATUS_CHIP_CLASS: { success: '', neutral: '' },
      STATUS_TEXT_CLASS: { destructive: '', neutral: '' },
      t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${String(params.count)}` : key,
      deadlineTone: () => 'neutral',
      deadlineText: () => '—',
      toggleReached: () => {},
      openEdit: () => {},
      deleteTarget: ref(null),
      deleting: ref(false),
      confirmDelete: () => {},
    }
    const app = createSSRApp(defineComponent({ setup: () => bindings, render }))
    for (const name of [
      'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardContent',
      'SharedPageState', 'Skeleton', 'Badge', 'Button', 'CheckCircle2',
      'Pencil', 'RotateCcw', 'Trash2',
    ]) app.component(name, Stub)
    app.component('TooltipProvider', TooltipProvider)
    app.component('Tooltip', TooltipRoot)
    app.component('TooltipTrigger', TooltipTrigger)
    app.component('TooltipContent', TooltipContent)

    const html = await renderToString(app)
    expect(html).toContain('data-testid="milestone-row"')
    expect(html).toContain('data-state="closed"')
  })
})
