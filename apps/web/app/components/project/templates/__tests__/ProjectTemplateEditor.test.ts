import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ProjectTemplateCreateSchema, type ProjectTemplateCreate } from '../../../../../../../packages/contracts/src/pmo/project-template'
import * as Vue from 'vue'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const filename = resolve(dirname(fileURLToPath(import.meta.url)), '../ProjectTemplateEditor.vue')
const source = readFileSync(filename, 'utf8')
const definition = {
  stages: [{ key: 'plan', name: 'Plan', fold: false }, { key: 'deliver', name: 'Deliver', fold: false }],
  milestones: [{ key: 'launch', name: 'Launch', offset_days: 3 }],
  tasks: [
    { key: 'brief', name: 'Brief', stage_key: 'plan', start_offset: 0, duration_days: 1, milestone_key: 'launch', dependency_keys: [] },
    { key: 'build', name: 'Build', stage_key: 'deliver', start_offset: 1, duration_days: 2, milestone_key: null, dependency_keys: ['brief'] },
  ],
}

function editor() {
  const descriptor = parse(source, { filename }).descriptor
  const script = compileScript(descriptor, { id: 'template-editor-test' }).content
  const code = ts.transpileModule(script, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  type EditorState = {
    draft: ProjectTemplateCreate
    dirty: Vue.ComputedRef<boolean>
    disabled: Vue.ComputedRef<boolean>
    validationError: Vue.Ref<string>
    submit: () => void
    removeStage: (index: number) => void
    removeTask: (index: number) => void
    removeMilestone: (index: number) => void
    milestoneItems: Vue.ComputedRef<Array<{ value: string; label: string }>>
    selectMilestone: (task: ProjectTemplateCreate['definition']['tasks'][number], value: unknown) => void
  }
  const exports = { default: null as unknown as { setup: (props: unknown, context: unknown) => EditorState } }
  const hydrated = Vue.ref(false)
  const require = (name: string) => name === 'vue' ? Vue : { ProjectTemplateCreateSchema }
  new Function('require', 'exports', 'useHydrated', 'useI18n', 'reactive', 'ref', 'computed', 'watch', code)(
    require, exports, () => hydrated, () => ({ t: (key: string) => key }), Vue.reactive, Vue.ref, Vue.computed, Vue.watch,
  )
  const props = Vue.reactive({
    template: Vue.readonly({ id: 7, name: 'Template', description: '', definition, can_manage: true, can_apply: true }),
    busy: false, resetKey: 0,
  })
  const emitted: Array<[string, unknown]> = []
  const scope = Vue.effectScope()
  const state = scope.run(() => exports.default.setup(props, { emit: (name: string, payload: unknown) => emitted.push([name, payload]), expose: () => {} }))!
  return { props, state, hydrated, emitted, stop: () => scope.stop() }
}

describe('ProjectTemplateEditor production setup', () => {
  it('detaches actual deeply readonly Vue data and acknowledges only a successful reset', async () => {
    const view = editor()
    expect(view.state.draft.definition.tasks).toHaveLength(2)
    expect(view.state.dirty.value).toBe(false)
    view.hydrated.value = true
    view.state.draft.name = 'Edited'
    view.state.submit()
    expect(view.emitted[0]?.[0]).toBe('save')
    expect(view.state.dirty.value).toBe(true)
    view.props.busy = true
    expect(view.state.disabled.value).toBe(true)
    view.state.submit()
    expect(view.emitted).toHaveLength(1)
    // A failed request leaves the submitted draft dirty.
    view.props.busy = false
    expect(view.state.dirty.value).toBe(true)
    view.props.resetKey += 1
    await Vue.nextTick()
    expect(view.state.dirty.value).toBe(false)
    expect(view.props.template.name).toBe('Template')
    view.stop()
  })

  it('disables submission before hydration and clears deleted optional references', () => {
    const view = editor()
    expect(view.state.disabled.value).toBe(true)
    view.state.submit()
    expect(view.emitted).toHaveLength(0)
    view.hydrated.value = true
    expect(view.state.disabled.value).toBe(false)
    view.state.removeStage(0)
    expect(view.state.draft.definition.stages).toHaveLength(2)
    expect(view.state.validationError.value).toBe('projects.templates.validation.stageInUse')
    view.state.removeMilestone(0)
    expect(view.state.draft.definition.tasks[0]!.milestone_key).toBeNull()
    view.state.removeTask(0)
    expect(view.state.draft.definition.tasks[0]!.dependency_keys).toEqual([])
    view.state.removeStage(0)
    expect(view.state.draft.definition.stages).toHaveLength(1)
    expect(ProjectTemplateCreateSchema.safeParse(view.state.draft).success).toBe(true)
    expect(view.props.template.definition.milestones).toHaveLength(1)
    view.stop()
  })

  it('keeps a valid milestone named none distinct from the no-milestone choice', () => {
    const view = editor()
    view.hydrated.value = true
    view.state.draft.definition.milestones[0]!.key = 'none'
    const task = view.state.draft.definition.tasks[0]!
    view.state.selectMilestone(task, 'none')
    expect(task.milestone_key).toBe('none')
    expect(ProjectTemplateCreateSchema.safeParse(view.state.draft).success).toBe(true)
    const clear = view.state.milestoneItems.value.find(item => item.label === 'projects.templates.none')!
    expect(clear.value).not.toBe('none')
    view.state.selectMilestone(task, clear.value)
    expect(task.milestone_key).toBeNull()
    view.stop()
  })

  it('localizes invalid graph feedback without exposing internal row keys', () => {
    const view = editor()
    view.hydrated.value = true
    view.state.draft.definition.tasks[0]!.dependency_keys = ['build']
    view.state.submit()
    expect(view.emitted).toHaveLength(0)
    expect(view.state.validationError.value).toBe('projects.templates.validation.dependencyCycle')
    view.stop()
  })
})
