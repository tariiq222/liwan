import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import type { TaskDetail } from '@nasq/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { isDirtySnapshot } from '../../../lib/formDirty'
import { richTextHasContent } from '../../../utils/richText'
import { sanitizeHtml } from '../../../utils/sanitize'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../TaskDescription.vue')
const source = readFileSync(filename, 'utf8')

type Mutation = {
  mutateAsync: (input: { id: number; patch: { description: string } }) => Promise<TaskDetail>
  isPending: Vue.Ref<boolean>
}

type DescriptionState = {
  editing: Vue.Ref<boolean>
  draft: Vue.Ref<string>
  renderedHtml: Vue.ComputedRef<string>
  startEdit: () => void
  cancelEdit: () => void
  onDescriptionDraft: (value: { html: string; taskId: number }) => void
  save: () => Promise<void>
}

const mountedScopes: Vue.EffectScope[] = []

function loadSetup(mutation: Mutation) {
  const descriptor = parse(source, { filename }).descriptor
  const script = compileScript(descriptor, { id: 'task-description-test' }).content
  const code = ts.transpileModule(script, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const module = { exports: {} as { default?: { setup: (props: unknown, context: unknown) => DescriptionState } } }
  const localRequire = (request: string) => {
    if (request === 'vue') return Vue
    if (request.endsWith('/useTasks')) return { useUpdateTask: () => mutation }
    if (request.endsWith('/formDirty')) return { isDirtySnapshot }
    if (request.endsWith('/sanitize')) return { sanitizeHtml }
    if (request.endsWith('/richText')) return { richTextHasContent }
    if (request.endsWith('/DescriptionEditor.vue')) return {}
    return {}
  }
  new Function('require', 'exports', 'module', 'useI18n', 'useHydrated', 'ref', 'computed', 'watch', code)(
    localRequire,
    module.exports,
    module,
    () => ({ t: (key: string) => key }),
    () => Vue.ref(true),
    Vue.ref,
    Vue.computed,
    Vue.watch,
  )

  const task = Vue.reactive({
    id: 7,
    can_write: true,
    description_html: '<p>Saved</p>',
  })
  const scope = Vue.effectScope()
  const state = scope.run(() => module.exports.default!.setup({ task }, { expose: () => {} }))!
  mountedScopes.push(scope)
  return { task, state }
}

function savedTask(description: string): TaskDetail {
  return { id: 7, description_html: description } as TaskDetail
}

afterEach(() => {
  for (const scope of mountedScopes.splice(0)) scope.stop()
})

describe('TaskDescription production behavior', () => {
  it('renders sanitized read content and cancel never submits a late editor draft', async () => {
    const calls: unknown[] = []
    const mutation: Mutation = {
      isPending: Vue.ref(false),
      mutateAsync: async (input) => { calls.push(input); return savedTask(input.patch.description) },
    }
    const { state, task } = loadSetup(mutation)

    expect(state.renderedHtml.value).toBe('<p>Saved</p>')
    task.description_html = '<p>Safe</p><script>window.__xss=1</script>'
    await Vue.nextTick()
    expect(state.renderedHtml.value).toBe('<p>Safe</p>')
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Draft</p>', taskId: 7 })
    state.cancelEdit()
    // This models DescriptionEditor's debounced/unmount update arriving after
    // cancel; TaskDescription deliberately has no update:model-value listener.
    state.onDescriptionDraft({ html: '<p>Late</p>', taskId: 7 })

    expect(calls).toHaveLength(0)
    expect(state.editing.value).toBe(false)
    expect(state.draft.value).toBe(task.description_html)
    await Promise.resolve()
  })

  it('submits the immediate draft once and returns to server-backed read mode', async () => {
    const calls: Array<{ id: number; patch: { description: string } }> = []
    const mutation: Mutation = {
      isPending: Vue.ref(false),
      mutateAsync: async (input) => { calls.push(input); return savedTask('<p>Server result</p>') },
    }
    const { state } = loadSetup(mutation)
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Edited</p>', taskId: 7 })

    await state.save()

    expect(calls).toEqual([{ id: 7, patch: { description: '<p>Edited</p>' } }])
    expect(state.editing.value).toBe(false)
    expect(state.renderedHtml.value).toBe('<p>Server result</p>')
  })

  it('preserves the draft and edit mode when the explicit save fails', async () => {
    const mutation: Mutation = {
      isPending: Vue.ref(false),
      mutateAsync: async () => { throw new Error('request failed') },
    }
    const { state } = loadSetup(mutation)
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Keep this draft</p>', taskId: 7 })

    await state.save()

    expect(state.editing.value).toBe(true)
    expect(state.draft.value).toBe('<p>Keep this draft</p>')
  })
})
