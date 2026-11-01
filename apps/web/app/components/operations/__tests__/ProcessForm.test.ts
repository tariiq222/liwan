import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import { OperationProcessSchema } from '@liwan/contracts'
import { OperationStageApprovalModeSchema } from '@liwan/contracts'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it } from 'vitest'
import * as forms from '../../../composables/operations/forms'
import { joinList } from '../../../utils/listFormat'

const filename = resolve(import.meta.dirname, '../ProcessForm.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const script = compileScript(descriptor, { id: 'operation-process-form' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const js = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const original = OperationProcessSchema.parse({ id: 3, purpose: 'work', stage_approval_mode: 'per_stage', name: 'Original', description: '', execution_kind: 'approval', state: 'draft', revision: 4, steps: [{ name: 'Manager review', reviewer_ids: [7], reviewers: [{ id: 7, user_id: 7, name: 'Manager' }], ineligible_reviewer_ids: [], resolver: null, resolver_label: null }] })
const latest = OperationProcessSchema.parse({ ...original, purpose: 'employee', stage_approval_mode: 'single', name: 'Server changed', description: 'Latest description', revision: 9, steps: [{ name: 'New review', reviewer_ids: [8], reviewers: [{ id: 8, user_id: 8, name: 'Reviewer' }], ineligible_reviewer_ids: [], resolver: null, resolver_label: null }] })

let resolvers: { items: { key: string; label: string }[]; total: number } = { items: [], total: 0 }

function form(conflict = true, process = original) {
  const scope = Vue.effectScope()
  const bodies: unknown[] = []
  const props = Vue.reactive({ process, disabled: false, backTo: '/settings/apps/operations/processes', refresh: async () => latest, save: async (body: unknown) => { bodies.push(body); if (conflict) throw { status: 409 }; return { ...original, revision: 5 } } })
  const bindings = { OperationStageApprovalModeSchema, _defineComponent: Vue.defineComponent, computed: Vue.computed, ref: Vue.ref, nextTick: Vue.nextTick, ...forms, joinList, useI18n: () => ({ t: (key: string) => key, te: () => true }), useHydrated: () => Vue.ref(true), useOperationExecutionKinds: () => ({ data: Vue.ref({ items: ['approval', 'pmo_completion'], total: 2 }), error: Vue.ref(null), isPending: Vue.ref(false) }), useOperationReviewerResolvers: () => ({ data: Vue.ref(resolvers) }) }
  const component = new Function(...Object.keys(bindings), js)(...Object.values(bindings))
  const state = scope.run(() => component.setup(props, { expose: () => {}, emit: () => {} }))
  return { state, props, bodies, stop: () => scope.stop() }
}

describe('operation process form baseline', () => {
  it('preserves a dirty draft and its revision until latest fields are explicitly accepted', async () => {
    const f = form()
    f.state.name.value = 'Local draft'
    f.props.process = latest
    await Vue.nextTick()
    expect(f.state.name.value).toBe('Local draft')
    expect(f.state.steps.value[0].reviewer_ids).toEqual([7])
    await f.state.submit()
    expect(f.bodies[0]).toEqual({ name: 'Local draft', description: '', purpose: 'work', stage_approval_mode: 'per_stage', execution_kind: 'approval', steps: [{ name: 'Manager review', reviewer_ids: [7], resolver: null }], revision: 4 })
    expect(f.state.dirty.value).toBe(true)
    await f.state.requestReload()
    expect(f.state.reloadRequested.value).toBe(true)
    expect(f.state.name.value).toBe('Local draft')
    await f.state.reload() // The inline confirmation accepts replacing the draft.
    expect(f.state.reloadRequested.value).toBe(false)
    expect(f.state.name.value).toBe('Server changed')
    expect(f.state.steps.value[0].reviewer_ids).toEqual([8])
    expect(f.state.purpose.value).toBe('employee')
    expect(f.state.stageApprovalMode.value).toBe('single')
    expect(f.state.dirty.value).toBe(false)
    await f.state.submit()
    expect(f.bodies[1]).toEqual({ name: 'Server changed', description: 'Latest description', purpose: 'employee', stage_approval_mode: 'single', execution_kind: 'approval', steps: [{ name: 'New review', reviewer_ids: [8], resolver: null }], revision: 9 })
    f.stop()
  })
  it('accepts the new revision after a successful save', async () => {
    const f = form(false)
    f.state.name.value = 'Saved draft'
    await f.state.submit()
    expect(f.state.dirty.value).toBe(false)
    f.state.name.value = 'Second draft'
    await f.state.submit()
    expect(f.bodies[1]).toMatchObject({ name: 'Second draft', revision: 5 })
    f.stop()
  })

  it('marks a chosen reviewer who lacks the review capability, and clears the mark when the server no longer reports one', async () => {
    const f = form(false)
    expect(f.state.ineligibleHint(f.state.steps.value[0])).toBeUndefined()
    f.state.ineligibleIds.value = new Set([7])
    expect(f.state.ineligibleHint(f.state.steps.value[0])).toBe('operations.ineligibleReviewers')
    f.state.steps.value[0].reviewer_ids = []
    expect(f.state.ineligibleHint(f.state.steps.value[0])).toBeUndefined()
    f.stop()
  })

  it('lets a stage hand its reviewers to a server resolver and saves it with no named users', async () => {
    resolvers = { items: [{ key: 'hr_leave_approver', label: 'Direct manager' }], total: 1 }
    const f = form(false)
    expect(f.state.showSource(f.state.steps.value[0])).toBe(true)
    expect(f.state.sourceItems(f.state.steps.value[0]).map((item: { value: string }) => item.value)).toEqual(['named', 'hr_leave_approver'])
    f.state.setSource(0, 'hr_leave_approver')
    f.state.steps.value[0].reviewer_ids = []
    await f.state.submit()
    expect(f.state.errors.value).toEqual({})
    expect(f.bodies[0]).toMatchObject({ steps: [{ name: 'Manager review', reviewer_ids: [], resolver: 'hr_leave_approver' }] })
    resolvers = { items: [], total: 0 }
    f.stop()
  })
  it('requires named users only for a named stage and keeps a seeded resolver on save', async () => {
    const seeded = OperationProcessSchema.parse({ ...original, execution_kind: 'hr_leave', steps: [{ name: 'Direct manager', reviewer_ids: [], reviewers: [], ineligible_reviewer_ids: [], resolver: 'hr_leave_approver', resolver_label: 'Direct manager' }, { name: 'Named', reviewer_ids: [7], reviewers: [{ id: 7, user_id: 7, name: 'Manager' }], ineligible_reviewer_ids: [], resolver: null, resolver_label: null }] })
    const f = form(false, seeded)
    expect(f.state.showSource(f.state.steps.value[0])).toBe(true)
    expect(f.state.sourceItems(f.state.steps.value[0]).map((item: { value: string; label: string }) => [item.value, item.label])).toEqual([['named', 'operations.namedReviewers'], ['hr_leave_approver', 'Direct manager']])
    f.state.steps.value[1].reviewer_ids = []
    await f.state.submit()
    expect(f.state.errors.value).toEqual({ 'steps.1.reviewer_ids': 'reviewersRequired' })
    expect(f.bodies).toHaveLength(0)
    f.state.steps.value[1].reviewer_ids = [7]
    await f.state.submit()
    expect(f.bodies[0]).toMatchObject({ execution_kind: 'hr_leave', steps: [{ name: 'Direct manager', reviewer_ids: [], resolver: 'hr_leave_approver' }, { name: 'Named', reviewer_ids: [7], resolver: null }] })
    f.stop()
  })
})
