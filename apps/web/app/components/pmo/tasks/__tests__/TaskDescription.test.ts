import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import type { TaskDetail } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { isDirtySnapshot } from '../../../../lib/formDirty'
import { richTextHasContent } from '../../../../utils/richText'
import { sanitizeHtml } from '@liwan/ui/app/utils/sanitize'

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
  onFocusOut: (event: unknown) => void
  onEditorKeydown: (event: unknown) => void
  onReadClick: (event: unknown) => void
}

const mountedScopes: Vue.EffectScope[] = []

function loadSetup(mutation: Mutation, toasts: unknown[] = []) {
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
  new Function('require', 'exports', 'module', 'useI18n', 'useHydrated', 'useToast', 'ref', 'computed', 'watch', code)(
    localRequire,
    module.exports,
    module,
    () => ({ t: (key: string) => key }),
    () => Vue.ref(true),
    () => ({ add: (toast: unknown) => toasts.push(toast) }),
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
    const toasts: unknown[] = []
    const { state } = loadSetup(mutation, toasts)
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Edited</p>', taskId: 7 })

    await state.save()

    expect(calls).toEqual([{ id: 7, patch: { description: '<p>Edited</p>' } }])
    expect(toasts).toEqual([{ title: 'tasks.descriptionField.saved', color: 'success' }])
    expect(state.editing.value).toBe(false)
    expect(state.renderedHtml.value).toBe('<p>Server result</p>')
  })

  it('preserves the draft and edit mode when the explicit save fails', async () => {
    const mutation: Mutation = {
      isPending: Vue.ref(false),
      mutateAsync: async () => { throw new Error('request failed') },
    }
    const toasts: unknown[] = []
    const { state } = loadSetup(mutation, toasts)
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Keep this draft</p>', taskId: 7 })

    await state.save()

    expect(toasts).toEqual([])
    expect(state.editing.value).toBe(true)
    expect(state.draft.value).toBe('<p>Keep this draft</p>')
  })

  const editor = (inside: boolean) => ({ relatedTarget: inside ? {} : null, currentTarget: { contains: () => inside } })
  const key = (init: Record<string, unknown>, closest: unknown = null) => {
    const event = { defaultPrevented: false, metaKey: false, ctrlKey: false, target: { closest: () => closest }, preventDefault() { this.defaultPrevented = true }, stopPropagation() {}, ...init }
    return event
  }

  it('opens from a click on the text but not from a click on a link inside it', () => {
    const { state } = loadSetup({ isPending: Vue.ref(false), mutateAsync: async () => savedTask('') })
    state.onReadClick({ target: { closest: () => ({}) } })
    expect(state.editing.value).toBe(false)
    state.onReadClick({ target: { closest: () => null } })
    expect(state.editing.value).toBe(true)
  })

  it('saves when focus leaves the editor, and ignores focus moving to its toolbar', async () => {
    const calls: unknown[] = []
    const { state } = loadSetup({ isPending: Vue.ref(false), mutateAsync: async (input) => { calls.push(input); return savedTask('<p>Out</p>') } })
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Out</p>', taskId: 7 })
    state.onFocusOut(editor(true))
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    state.onFocusOut(editor(false))
    await new Promise(resolve => setTimeout(resolve))
    expect(calls).toEqual([{ id: 7, patch: { description: '<p>Out</p>' } }])
    expect(state.editing.value).toBe(false)
  })

  it('closes without a request when nothing changed', async () => {
    const calls: unknown[] = []
    const { state } = loadSetup({ isPending: Vue.ref(false), mutateAsync: async (input) => { calls.push(input); return savedTask('') } })
    state.startEdit()
    state.onFocusOut(editor(false))
    await new Promise(resolve => setTimeout(resolve))
    expect(calls).toHaveLength(0)
    expect(state.editing.value).toBe(false)
  })

  it('cancels on Escape without saving, but leaves the link field its own Escape', () => {
    const calls: unknown[] = []
    const { state } = loadSetup({ isPending: Vue.ref(false), mutateAsync: async (input) => { calls.push(input); return savedTask('') } })
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Typed</p>', taskId: 7 })
    state.onEditorKeydown(key({ key: 'Escape' }, {}))
    expect(state.editing.value).toBe(true)
    state.onEditorKeydown(key({ key: 'Escape' }))
    expect(state.editing.value).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('saves on Ctrl/Cmd+Enter', async () => {
    const calls: unknown[] = []
    const { state } = loadSetup({ isPending: Vue.ref(false), mutateAsync: async (input) => { calls.push(input); return savedTask('<p>Typed</p>') } })
    state.startEdit()
    state.onDescriptionDraft({ html: '<p>Typed</p>', taskId: 7 })
    state.onEditorKeydown(key({ key: 'Enter' }))
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    state.onEditorKeydown(key({ key: 'Enter', ctrlKey: true }))
    await new Promise(resolve => setTimeout(resolve))
    expect(calls).toHaveLength(1)
    expect(state.editing.value).toBe(false)
  })
})
