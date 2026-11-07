import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { saveErrorMessage } from '../../../../utils/formFeedback'
import { mayFinalizeCreate, projectBasicsFromAi } from '../../../../utils/aiDraft'

function load({ failure = null as unknown, draft = null as any, requiredEnd = false, hydrated = true } = {}) {
 const filename = resolve(import.meta.dirname, '../ProjectCreateForm.vue')
 const script = compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'create'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const code = ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText
 const mutate = vi.fn(async (_body:any) => {if(failure) throw failure; return {id:42}})
 const bindings = { _defineComponent:Vue.defineComponent, ref:Vue.ref, computed:Vue.computed, watch:Vue.watch, nextTick:Vue.nextTick,
 useI18n:()=>({t:(k:string)=>k}), useRoute:()=>({query:draft?{aiDraft:'draft'}:{}}), useHydrated:()=>Vue.ref(hydrated), useMe:()=>({me:Vue.ref({id:7,name:'Mona'})}),
 useProjectCreateDefaults:()=>({data:Vue.ref({default_manager_id:7,require_manager_on_create:true,require_end_date_on_create:requiredEnd}),isPending:Vue.ref(false),isError:Vue.ref(false),isFetching:Vue.ref(false),refetch:vi.fn()}),
 useCreateProject:()=>({mutateAsync:mutate,isPending:Vue.ref(false)}),readAiDraft:()=>draft,parsePositiveId:()=>null,mayFinalizeCreate,projectBasicsFromAi,saveErrorMessage,ProjectBasicsFields:{},ProjectCopyForm:{},
 }
 const component = new Function(...Object.keys(bindings),code)(...Object.values(bindings)); const emit = vi.fn(); const scope = Vue.effectScope()
 const state = scope.run(()=>component.setup({}, {emit,expose:()=>{}}))
 return {state,mutate,emit,stop:()=>scope.stop()}
}
describe('simple project creation',()=>{
 it('creates once with core objectives and emits the project without a charter transition', async()=>{
  const v=load(); expect(typeof v.state.submit).toBe('function')
  v.state.draft.value.name='  Alpha '; v.state.draft.value.objectives=[{goal:'First',metric:'count',target:'20'},{goal:'Second',metric:'',target:''}];v.state.draft.value.success_criteria='20 in one month'
  await v.state.submit()
  expect(v.mutate).toHaveBeenCalledExactlyOnceWith({name:'Alpha',description:'',user_id:7,objectives:[{goal:'First',metric:'count',target:'20'},{goal:'Second',metric:'',target:''}],success_criteria:'20 in one month'})
  expect(v.emit).toHaveBeenCalledWith('created',42);v.stop()
 })
 it('retains the entire draft after a failed request and never retries automatically',async()=>{
  const v=load({failure:new Error('offline')});expect(typeof v.state.submit).toBe('function');v.state.draft.value.name='Keep me';await v.state.submit();expect(v.state.draft.value.name).toBe('Keep me');expect(v.state.error.value).toBeTruthy();expect(v.mutate).toHaveBeenCalledTimes(1);expect(v.emit).not.toHaveBeenCalled();v.stop()
 })
 it('enforces explicit company end-date requirements',async()=>{
  const v=load({requiredEnd:true});expect(typeof v.state.submit).toBe('function');v.state.draft.value.name='Alpha';await v.state.submit();expect(v.mutate).not.toHaveBeenCalled();v.stop()
 })
 it('requires attestation on AI drafts',async()=>{
  const v=load({draft:{payload:{name:'AI',objectives:[{goal:'Goal'}],success_criteria:'Success'}}});expect(typeof v.state.submit).toBe('function');await v.state.submit();expect(v.mutate).not.toHaveBeenCalled();v.state.attested.value=true;await v.state.submit();expect(v.mutate).toHaveBeenCalledTimes(1);v.stop()
 })
 it('creates with both reviewable AI dates',async()=>{
  const v=load({draft:{payload:{name:'AI dates',date_start:'2030-02-01',date_end:'2030-03-01'}}});v.state.attested.value=true;await v.state.submit()
  expect(v.mutate).toHaveBeenCalledWith(expect.objectContaining({date_start:'2030-02-01',date_end:'2030-03-01'}));v.stop()
 })

})
