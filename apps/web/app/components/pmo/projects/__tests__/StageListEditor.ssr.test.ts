import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { computed, createSSRApp, defineComponent, h, ref, type RenderFunction } from 'vue'
import { TooltipContent, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'
import { describe, expect, it } from 'vitest'

const filename = new URL('../StageListEditor.vue', import.meta.url)
const source = readFileSync(filename, 'utf8')
const parsed = parse(source, { filename: filename.pathname })
if (!parsed.descriptor.template) throw new Error('no template')
const compiled = compileTemplate({
  source: parsed.descriptor.template.content,
  filename: filename.pathname,
  id: 'stage-list-editor-ssr',
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

describe('StageListEditor SSR', () => {
  async function renderStages(stages: { id: number; name: string; fold: boolean; task_count: number }[]) {
    const localStages = ref(stages)
    const hydrated = ref(true)
    const bindings = {
      props: { busy: false },
      stages,
      localStages,
      hydrated,
      disabled: computed(() => false),
      editingId: ref<number | string | null>(null),
      editDraft: ref(''),
      pendingDeleteId: ref<number | string | null>(null),
      renameInputEl: ref<HTMLInputElement | null>(null),
      newName: ref(''),
      t: (key: string, params?: Record<string, unknown>) => params ? `${key}:${String(params.count)}` : key,
      onDragEnd: () => {},
      onHandleKeydown: () => {},
      startRename: () => {},
      cancelRename: () => {},
      commitRename: () => {},
      onFoldChange: () => {},
      submitAdd: () => {},
      requestDelete: () => {},
      cancelDelete: () => {},
      confirmDelete: () => {},
    }
    const app = createSSRApp(defineComponent({ setup: () => bindings, render }))
    for (const name of ['UButton', 'UInput', 'USwitch', 'UIcon', 'VueDraggable']) app.component(name, Stub)
    app.component('UTooltip', defineComponent({
      props: ['text'],
      setup(props, { slots }) {
        // A closed tooltip renders no content on the server, so the text it was
        // given is surfaced here; the provider context is still exercised.
        return () => h('div', { 'data-tooltip-text': props.text }, [
          h(TooltipProvider, {}, { default: () => h(TooltipRoot, {}, { default: () => [
            h(TooltipTrigger, { asChild: true }, { default: () => slots.default?.() }),
            h(TooltipContent, {}, { default: () => props.text }),
          ] }) }),
        ])
      },
    }))
    app.component('TooltipProvider', TooltipProvider)
    app.component('Tooltip', TooltipRoot)
    app.component('TooltipTrigger', TooltipTrigger)
    app.component('TooltipContent', TooltipContent)

    return renderToString(app)
  }

  it('offers a plain delete for an empty stage', async () => {
    const html = await renderStages([{ id: 1, name: 'Empty', fold: false, task_count: 0 }])
    expect(html).toContain('data-testid="stage-delete"')
    // The rename pencil carries the only tooltip; the delete of an empty stage has none (no reason to explain).
    expect([...html.matchAll(/data-tooltip-text="([^"]*)"/g)].map(match => match[1])).toEqual(['projects.stages.rename'])
  })

  it('replaces the delete of an occupied stage with a tooltip naming the count', async () => {
    // A stage holding tasks cannot be deleted, and the reason has to be
    // readable rather than a control that silently does nothing.
    const html = await renderStages([{ id: 1, name: 'In use', fold: false, task_count: 2 }])
    expect(html).toContain('data-tooltip-text="projects.stages.notEmpty:2"')
    expect(html).toContain('data-state="closed"')
    // The control stays visible and disabled inside the tooltip, so the reason
    // is reachable; a removed button would explain nothing.
    expect(html).toMatch(/data-tooltip-text="projects\.stages\.notEmpty:2"[\s\S]*data-testid="stage-delete"[^>]*disabled/)
  })
})
