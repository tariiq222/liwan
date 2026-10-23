import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

async function render(personal: boolean, cancellationState?: 'approved' | 'refused') {
  const filename = resolve(import.meta.dirname, '../../../components/hr/LeaveRecord.vue')
  const descriptor = parse(readFileSync(filename,'utf8'),{filename}).descriptor
  const script = compileScript(descriptor,{id:'own-leave-record'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
  const transpile = (code:string) => ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
  const leave = {id:7,employee:{id:4,name:'Sara'},leave_type:{id:2,name:'Annual'},state:'validate',date_from:'2026-11-01',date_to:'2026-11-02',number_of_days:2,notes:'',can_approve:true,can_refuse:true,can_cancel:false,can_withdraw:true, cancellation_policy: 'manager_approval', cancellation: cancellationState ? {id:8,state:cancellationState,revision:2,reason:'Plans changed',requested_at:'2026-10-23 12:00:00',initiator:{id:2,name:'Sara'},reviewer:{id:3,name:'Manager'},reviewed_at:'2026-10-23 13:00:00',review_reason:'Decision'} : null, can_request_cancellation: true, can_approve_cancellation: true, can_refuse_cancellation: true}
  const query = () => ({data:Vue.ref(leave),error:Vue.ref(null),isLoading:Vue.ref(false),refetch:vi.fn()})
  const bindings = {
    _defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,
    useRoute:() => ({params:{leaveId:'7'},query:{},hash:''}),useI18n:() => ({t:(key:string) => key}),
    useAccess:() => ({can:() => true}),useHydrated:() => Vue.ref(true),useHrLeaveFormat:() => ({period:() => '',days:String}),
    useMyHrLeaveRequest:query,useHrLeaveRequest:query,useCancellationDecision:() => ({isPending:Vue.ref(false),mutateAsync:vi.fn()}),useLeaveDecision:() => ({isPending:Vue.ref(false),mutateAsync:vi.fn()}),useWithdrawLeaveRequest:() => ({isPending:Vue.ref(false),mutateAsync:vi.fn()}),
    owningListBack:() => '/account/leave',hrLeaveBadge:() => ({tone:'success',labelKey:'approved'}),statusTag:() => ({}),ApiError:Error,
  }
  const component = new Function(...Object.keys(bindings),transpile(script))(...Object.values(bindings))
  const state = component.setup({personal},{expose:() => {}})
  const template = compileTemplate({source:descriptor.template!.content,filename,id:'own-leave-record',compilerOptions:{mode:'function',expressionPlugins:['typescript']}})
  if(template.errors.length) throw template.errors[0]
  const render = new Function('Vue',transpile(template.code))(Vue)
  const app = Vue.createSSRApp(Vue.defineComponent({setup:() => ({...state}),render}))
  for(const name of ['SharedRecordPage','SharedIdentityCard','SharedRecordSection','SharedPropertiesPanel','SharedPropertyRow','HrLeaveDecisionConfirm','UAlert']) app.component(name,Vue.defineComponent({setup(_, {slots}) {return () => Vue.h('div',[slots.actions?.(),slots.default?.(),slots.aside?.()])}}))
  app.component('UButton',Vue.defineComponent({inheritAttrs:false,setup(_,{attrs}) {return () => Vue.h('button',{'data-testid':attrs['data-testid']},String(attrs.label))}}))
  app.component('SharedStatusBadge',Vue.defineComponent({props:['tone','label'],setup(props){return ()=>Vue.h('span',{'data-tone':props.tone},props.label)}}))
  return renderToString(app)
}

describe('own leave record actions',() => {
  it('hides approve, refuse and administrative cancel for HR managers in Self-service while retaining withdrawal', async () => {
    const html = await render(true)
    expect(html).not.toContain('hr-leave-record-approve')
    expect(html).not.toContain('hr-leave-record-refuse')
    expect(html).not.toContain('hr-leave-record-cancel')
    expect(html).toContain('hr-leave-record-withdraw')
    expect(html).toContain('hr-leave-record-request-cancellation')
    expect(html).not.toContain('hr-leave-record-approve-cancellation')
  })
  it('preserves permitted management actions on the administrative record', async () => {
    const html = await render(false)
    expect(html).toContain('hr-leave-record-approve')
    expect(html).toContain('hr-leave-record-refuse')
    expect(html).toContain('hr-leave-record-request-cancellation')
  })
})


it.each([['refused','destructive'],['approved','success']] as const)('renders %s cancellation with the shared %s tone',async(state,tone)=>{
  expect(await render(true,state)).toContain(`data-tone="${tone}"`)
})
