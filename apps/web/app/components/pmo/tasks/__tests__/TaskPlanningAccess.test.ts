import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {compileScript,parse} from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import {describe,expect,it,vi} from 'vitest'
import {renderShared} from '@liwan/ui/test/helpers/renderShared'
import {taskDetail} from '../../../../../stories/fixtures/pmo'
function setup(path:string,props:any,bindings:Record<string,unknown>={}) {
 const filename=resolve(import.meta.dirname,path)
 const script=compileScript(parse(readFileSync(filename,'utf8'),{filename}).descriptor,{id:'planning'}).content.replace(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?\s*$/gm,'').replace('export default','return')
 const globals={_defineComponent:Vue.defineComponent,ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,useI18n:()=>({t:(key:string)=>key}),useHydrated:()=>Vue.ref(true),useRoute:()=>({hash:'#schedule'}),useSlots:()=>({schedule:()=>null}),useToast:()=>({add:vi.fn()}),...Object.fromEntries(['DependencyPicker','TaskActivity','TaskAttachments','TaskDescription','TaskDeliverables','SubtaskList','ScheduleTaskForm','RecordBlock'].map(name=>[name,{}])),...bindings}
 const component=new Function(...Object.keys(globals),ts.transpileModule(script,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.None}}).outputText)(...Object.values(globals));const scope=Vue.effectScope();const state=scope.run(()=>component.setup(props,{expose:()=>{}}));return{state,stop:()=>scope.stop()}
}
describe('task planning access',()=>{
 it.each([false,true])('offers the predecessor button only with planning=%s and nothing to show yet',planning=>{
  const read=()=>({data:Vue.ref({items:[]})})
  const v=setup('../TaskDetails.vue',{task:taskDetail({planning_enabled:planning,can_write:true,can_manage_dependencies:true,depends_on:[]})},{useTaskAttachments:read,useTaskDependencies:read})
  expect(v.state.showDependencies.value).toBe(false)
  expect(v.state.canAddDependency.value).toBe(planning)
  expect(v.state.canAddAttachment.value).toBe(true);v.stop()
 })
 it.each([false,true])('gates dependency and candidate request ids with planning=%s',planning=>{
  const ids:any[]=[];const read=(id:any)=>{ids.push(id);return{data:Vue.ref(undefined),hasNextPage:Vue.ref(false),fetchNextPage:vi.fn(),isFetchingNextPage:Vue.ref(false)}}
  const v=setup('../DependencyPicker.vue',{task:taskDetail({planning_enabled:planning,can_manage_dependencies:true})},{useTaskDependencies:read,useTaskDependencyCandidates:read,useUpdateTaskDependencies:()=>({mutate:vi.fn(),isPending:Vue.ref(false)}),taskStateBadge:()=>({}),badgeLabel:()=>'',ApiError:Error})
  expect(ids.map(id=>id.value)).toEqual(planning?[101,101]:[null,null]);v.stop()
 })
 it.each([false,true])('gates schedule and project request ids with planning=%s',planning=>{
  const ids:any[]=[];const read=(id:any)=>{ids.push(id);return{data:Vue.ref(undefined),error:Vue.ref(null),isLoading:Vue.ref(false)}}
  const v=setup('../../projects/schedule/ProjectTaskScheduleSection.vue',{projectId:14,taskId:10,planningEnabled:planning},{useProjectSchedule:read,useProject:read,ApiError:Error,formatCalendarDate:()=>''})
  expect(ids.map(id=>id.value)).toEqual(planning?[14,14]:[null,null]);v.stop()
 })
 it.each([false,true])('mounts only permitted advanced panels while retaining core sections with planning=%s',async planning=>{
  let dependencies=0;let schedule=0
  const child=(name:string)=>({__esModule:true,default:Vue.defineComponent({setup:()=>()=>Vue.h('span',name)})})
  const modules:Record<string,unknown>={
   '@/composables/useTaskAttachments':{useTaskAttachments:()=>({data:Vue.ref({items:[]})})},
   '@/composables/useTaskDependencies':{useTaskDependencies:()=>({data:Vue.ref({items:[{id:7}]})})},
   './DependencyPicker.vue':{__esModule:true,default:Vue.defineComponent({setup(){dependencies++;return()=>Vue.h('span','dependencies')}})},
  }
  for(const name of ['TaskActivity','TaskAttachments','TaskDescription','TaskDeliverables','SubtaskList'])modules[`./${name}.vue`]=child(name)
  const html=await renderShared(resolve(import.meta.dirname,'../TaskDetails.vue'),{task:taskDetail({planning_enabled:planning,can_write:true,can_manage_dependencies:true})},{schedule:()=>{schedule++;return Vue.h('span','schedule')}},{modules})
  expect(dependencies).toBe(planning?1:0);expect(schedule).toBe(planning?1:0)
  for(const core of ['SubtaskList','TaskActivity','TaskDescription'])expect(html).toContain(core)
  // Empty attachments are a small button, not a section; a task with predecessors shows their section instead of the button.
  expect(html).not.toContain('TaskAttachments');expect(html).toContain('tasks.detail.addAttachment');expect(html).not.toContain('tasks.detail.addDependsOn')
 })

})
