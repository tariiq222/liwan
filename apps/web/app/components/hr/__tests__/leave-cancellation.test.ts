import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'

const transpile=(code:string)=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
function component(file:string,bindings:Record<string,unknown>){
  const filename=resolve(import.meta.dirname,'..',file)
  const descriptor=parse(readFileSync(filename,'utf8'),{filename}).descriptor
  const script=compileScript(descriptor,{id:'cancel-test'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return').replace('export type','type')
  const loaded=new Function(...Object.keys(bindings),transpile(script))(...Object.values(bindings))
  return {loaded,descriptor,filename}
}
const leave={id:7,employee:{id:4,name:'Sara'},leave_type:{id:2,name:'Annual'},state:'validate',date_from:'2026-11-01',date_to:'2026-11-02',number_of_days:2,notes:'',can_approve:false,can_refuse:false,can_cancel:false,can_withdraw:false,cancellation_policy:'manager_approval',can_request_cancellation:false,can_approve_cancellation:true,can_refuse_cancellation:true,cancellation:{id:9,state:'pending',revision:1,reason:'First request',initiator:{id:4,name:'Sara'},requested_at:'2026-10-23 12:00:00',reviewed_at:null,reviewer:null,review_reason:null}}
function record(){
  const data=Vue.ref(structuredClone(leave)),mutate=vi.fn(),refetch=vi.fn()
  const query=()=>({data,error:Vue.ref(null),isLoading:Vue.ref(false),refetch})
  const mutation=()=>({isPending:Vue.ref(false),mutateAsync:vi.fn()})
  const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,useRoute:()=>({params:{leaveId:'7'},query:{},hash:''}),useI18n:()=>({t:String}),useAccess:()=>({can:()=>true}),useHydrated:()=>Vue.ref(true),useHrLeaveFormat:()=>({period:String,days:String}),useMyHrLeaveRequest:query,useHrLeaveRequest:query,useLeaveDecision:mutation,useWithdrawLeaveRequest:mutation,useCancellationDecision:()=>({isPending:Vue.ref(false),mutateAsync:mutate}),owningListBack:()=>'/hr/leave',hrLeaveBadge:()=>({tone:'success',labelKey:'approved'}),statusTag:()=>({}),ApiError:Error}
  const {loaded}=component('LeaveRecord.vue',bindings)
  return {state:loaded.setup({personal:false},{expose:()=>{}}),data,mutate,refetch}
}
describe('cancellation confirmation',()=>{
  it('submits the revision the manager reviewed even if a background read replaces the record',async()=>{
    const {state,data,mutate}=record()
    state.beginConfirm('approveCancellation')
    data.value={...data.value,cancellation:{...data.value.cancellation,revision:3,reason:'A different request'}}
    await state.onConfirm('Reviewed first request')
    expect(mutate).toHaveBeenCalledWith({id:7,revision:1,decision:'approve',reason:'Reviewed first request'})
  })
  it('requires a refusal reason in both the confirmation control and its emitted action',()=>{
    const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,useI18n:()=>({t:String}),useHrLeaveFormat:()=>({period:String})}
    const {loaded,descriptor,filename}=component('LeaveDecisionConfirm.vue',bindings)
    const emit=vi.fn(),state=loaded.setup({leave,kind:'refuseCancellation'},{expose:()=>{},emit})
    const code=compileTemplate({source:descriptor.template!.content,filename,id:'cancel-confirm',compilerOptions:{mode:'function',expressionPlugins:['typescript']}}).code
    const render=new Function('Vue',transpile(code))(Vue)
    const proxy=Vue.proxyRefs(state)
    const warning=vi.spyOn(console,'warn').mockImplementation(()=>{})
    let vnode=render(proxy,[])
    expect(vnode.props.disabled).toBe(true)
    vnode.props.onConfirm()
    expect(emit).not.toHaveBeenCalled()
    state.reason.value='  Team shortage  '
    vnode=render(proxy,[])
    expect(vnode.props.disabled).toBe(false)
    vnode.props.onConfirm()
    expect(emit).toHaveBeenCalledWith('confirm','Team shortage')
    warning.mockRestore()
  })
})
