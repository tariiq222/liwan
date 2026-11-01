import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { HrLeaveApprovalProcess } from '@liwan/contracts'

const filename = resolve(import.meta.dirname, '../LeaveApprovalCard.vue')
const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor
const transpile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText
const script = compileScript(descriptor, { id: 'leave-approval-card' }).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm, '').replace('export default', 'return')
const template = compileTemplate({ source: descriptor.template!.content, filename, id: 'leave-approval-card', compilerOptions: { mode: 'function', expressionPlugins: ['typescript'] } })
const process = { id: 2, name: 'Leave approval', revision: 1, steps: [
  { name: 'Direct manager', resolver: 'hr_leave_approver', resolver_label: 'Direct manager (time-off approver)', reviewers: [] },
  { name: 'Named', resolver: null, resolver_label: null, reviewers: [{ id: 1, user_id: 7, name: 'Nora' }, { id: 2, user_id: 8, name: 'Khalid' }] },
] }
const withProcess: HrLeaveApprovalProcess = { process, href: '/settings/apps/operations/processes/2', can_manage: true }
const without: HrLeaveApprovalProcess = { process: null, href: '/settings/apps/operations/processes', can_manage: true }

function card(approval: HrLeaveApprovalProcess, createDefault = vi.fn().mockResolvedValue(undefined)) {
  const bindings = {
    _defineComponent: Vue.defineComponent, ref: Vue.ref, computed: Vue.computed,
    useI18n: () => ({ t: (key: string) => key }), useHydrated: () => Vue.ref(true),
    useCreateDefaultLeaveApprovalProcess: () => ({ mutateAsync: createDefault, isPending: Vue.ref(false) }),
    joinList: (items: string[]) => items.join(', '), saveErrorMessage: (error: Error) => error.message,
  }
  const component = new Function(...Object.keys(bindings), transpile(script))(...Object.values(bindings))
  const state = component.setup({ approval }, { expose: () => {} })
  const render = new Function('Vue', transpile(template.code))(Vue)
  const html = async () => {
    const app = Vue.createSSRApp(Vue.defineComponent({ setup: () => ({ ...state, approval, t: (key: string, values?: { number: number }) => values ? `${key}#${values.number}` : key }), render }))
    for (const name of ['SharedFormSection', 'SharedSubCard', 'SharedInlineConfirm', 'UAlert']) app.component(name, Vue.defineComponent({ props: ['title'], setup(props, { slots }) { return () => Vue.h('div', { 'data-component': name }, [props.title, slots.default?.()]) } }))
    app.component('UButton', Vue.defineComponent({ inheritAttrs: false, setup(_, { attrs }) { return () => Vue.h('button', { 'data-testid': attrs['data-testid'], 'data-to': attrs.to }, String(attrs.label)) } }))
    return renderToString(app)
  }
  return { state, html, createDefault }
}

describe('leave approval settings card', () => {
  it('lists the stages by resolver label or reviewer names and links to the process editor for a manager', async () => {
    const html = await card(withProcess).html()
    expect(html).toContain('hr.leaveApproval.stage#1: Direct manager')
    expect(html).toContain('Direct manager (time-off approver)')
    expect(html).toContain('Nora, Khalid')
    expect(html).toContain('data-to="/settings/apps/operations/processes/2"')
    expect(html).not.toContain('hr-leave-approval-default')
  })
  it('does not offer the editor to a reader', async () => {
    expect(await card({ ...withProcess, can_manage: false }).html()).not.toContain('hr-leave-approval-edit')
  })
  it('offers the default process only to a manager, and asks inline before creating it', async () => {
    expect(await card({ ...without, can_manage: false }).html()).not.toContain('hr-leave-approval-default')
    const c = card(without)
    expect(await c.html()).toContain('hr-leave-approval-default')
    expect(await c.html()).not.toContain('SharedInlineConfirm')
    c.state.confirming.value = true
    expect(await c.html()).toContain('SharedInlineConfirm')
    expect(c.createDefault).not.toHaveBeenCalled()
    await c.state.useDefault()
    expect(c.createDefault).toHaveBeenCalledTimes(1)
    expect(c.state.confirming.value).toBe(false)
  })
  it('keeps the confirmation open and shows the failure when the server refuses', async () => {
    const c = card(without, vi.fn().mockRejectedValue(new Error('already exists')))
    c.state.confirming.value = true
    await c.state.useDefault()
    expect(c.state.confirming.value).toBe(true)
    expect(await c.html()).toContain('hr.leaveApproval.saveError')
  })
  it('never creates the default process for a reader', async () => {
    const c = card({ ...without, can_manage: false })
    await c.state.useDefault()
    expect(c.createDefault).not.toHaveBeenCalled()
  })
})
