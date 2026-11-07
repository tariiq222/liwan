import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {compileScript,parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import {projectDetail} from '../../../../../stories/fixtures/pmo'
import {useSettingsForm} from '../../../../composables/settings/useSettingsForm'
import {ApiError} from '../../../../composables/useApi'
beforeEach(()=>vi.stubGlobal('useI18n',()=>({t:(key:string)=>key})))
afterEach(()=>vi.unstubAllGlobals())
function load() {
 const filename=resolve(import.meta.dirname,'../ProjectSettingsForm.vue')
 const script=compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'settings'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const props=Vue.reactive({project:structuredClone(projectDetail)})
 let failure:unknown=null
 const mutate=vi.fn(async(input:any)=>{if(failure)throw failure;return {...props.project,...input.patch,name:input.patch.name ?? props.project.name,updated_at:'v3'}})
 const refetch=vi.fn(async()=>({data:props.project,isError:false}))
 const stage=()=>({mutate:vi.fn(),isPending:Vue.ref(false)})
 const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,useSettingsForm,ApiError,useI18n:()=>({t:(k:string)=>k}),useHydrated:()=>Vue.ref(true),useRoute:()=>({query:{},fullPath:'/projects/1/settings'}),useToast:()=>({add:vi.fn()}),useProject:()=>({refetch}),useUpdateProject:()=>({mutateAsync:mutate,isPending:Vue.ref(false)}),useAddStage:stage,useDeleteStage:stage,useReorderStages:stage,useUpdateStage:stage,...Object.fromEntries(['FollowerList','ProjectArchiveAction','ProjectToolsSettings','ProjectBasicsFields','ProjectGeneralForm','ProjectStatusSelect','StageListEditor'].map(name=>[name,{}]))}
 const component=new Function(...Object.keys(bindings),ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText)(...Object.values(bindings))
 const scope=Vue.effectScope();const state=scope.run(()=>component.setup(props,{expose:()=>{}}));return {state,props,mutate,refetch,setFailure:(value:unknown)=>{failure=value},stop:()=>scope.stop()}
}
describe('core settings draft recovery',()=>{
 it('preserves edits across a concurrent session and saves after explicit reload',async()=>{
  const v=load();v.state.basics.value.name='Local draft'
  v.props.project={...v.props.project,name:'Other session',updated_at:'v2'};await Vue.nextTick()
  expect(v.state.basics.value.name).toBe('Local draft');expect(v.state.basicsForm.state.value.conflict).toBe(true)
  await v.state.basicsForm.save();expect(v.mutate).not.toHaveBeenCalled()
  await v.state.basicsForm.reload();v.state.basics.value.name='Reviewed change';await v.state.basicsForm.save()
  expect(v.mutate).toHaveBeenCalledExactlyOnceWith({id:1,patch:{name:'Reviewed change',expected_updated_at:'v2'}});v.stop()
 })
 it('maps a stale server token to explicit recovery and keeps revert functional',async()=>{
  const v=load();v.state.basics.value.name='Keep me';v.setFailure(new ApiError(409,'stale_write','stale'));await v.state.basicsForm.save()
  expect(v.state.basics.value.name).toBe('Keep me');expect(v.state.basicsForm.state.value.conflict).toBe(true)
  v.state.basicsForm.revert();expect(v.state.basics.value.name).toBe(projectDetail.name)
  v.props.project={...v.props.project,updated_at:'v2'};v.setFailure(null);await v.state.basicsForm.reload();v.state.basics.value.name='After reload';await v.state.basicsForm.save()
  expect(v.mutate.mock.calls[1]).toEqual([{id:1,patch:{name:'After reload',expected_updated_at:'v2'}}]);v.stop()
 })
})
