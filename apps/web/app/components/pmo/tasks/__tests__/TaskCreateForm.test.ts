import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {compileScript,parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import {describe,expect,it,vi} from 'vitest'
import * as policy from '../../../../utils/taskCreatePolicy'
import {isDirtySnapshot} from '../../../../lib/formDirty'
import {validateTaskDates} from '../../../../utils/projectDateBounds'
import {ApiError} from '../../../../composables/useApi'
function load(planning=false) {
 const filename=resolve(import.meta.dirname,'../TaskCreateForm.vue')
 const script=compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'task-create'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const mutate=vi.fn(async()=>({id:8}));let milestoneId:any
 const project=Vue.ref({id:7,can_manage:true,date_start:null,date_end:null,tools:{planning:{enabled:planning}}})
 const bindings={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,nextTick:Vue.nextTick,...policy,isDirtySnapshot,validateTaskDates,ApiError,
 useI18n:()=>({t:(k:string)=>k}),useHydrated:()=>Vue.ref(true),useToast:()=>({add:vi.fn()}),useProjects:()=>({data:Vue.ref([{id:7,name:'Alpha'}])}),
 useProject:()=>({data:project,isLoading:Vue.ref(false),error:Vue.ref(null)}),
 useMilestones:(id:any)=>{milestoneId=id;return {data:Vue.ref([{id:2,name:'Legacy',start_date:'2030-01-01',deadline:'2030-02-01'}]),isLoading:Vue.ref(false),error:Vue.ref(null)}},
 useCreateTask:()=>({mutateAsync:mutate,isPending:Vue.ref(false)}),useUpdateTask:()=>({mutateAsync:vi.fn()}),useTransitionTask:()=>({mutateAsync:vi.fn()}),}
 const component=new Function(...Object.keys(bindings),ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText)(...Object.values(bindings));const scope=Vue.effectScope();const state=scope.run(()=>component.setup({projectId:7,mode:'project'},{emit:()=>{},expose:()=>{}}));return{state,mutate,project,milestoneId,stop:()=>scope.stop()}
}
describe('basic project task creation',()=>{
 it('suppresses milestone requests and requirements when planning is off',async()=>{
  const v=load();expect(v.milestoneId.value).toBeNull();v.state.name.value='Basic work';v.state.dateDeadline.value='2030-03-01';await v.state.submit();expect(v.mutate).toHaveBeenCalledExactlyOnceWith({name:'Basic work',project_id:7,date_deadline:'2030-03-01T23:59:00Z'});v.stop()
 })
 it('retains schedule draft values but omits them after policy changes',async()=>{
  const v=load(true);v.state.name.value='Keep draft';v.state.plannedStart.value='2030-01-10';v.project.value.tools.planning.enabled=false;await v.state.submit();expect(v.state.plannedStart.value).toBe('2030-01-10');expect(v.mutate).toHaveBeenCalledExactlyOnceWith({name:'Keep draft',project_id:7});v.stop()
 })
})
