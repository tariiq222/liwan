import {resolve} from 'node:path'
import {defineComponent,h,ref,nextTick,reactive} from 'vue'
import {describe,expect,it,vi} from 'vitest'
import {ProjectDetailSchema,type ProjectDetail} from '@liwan/contracts'
import {renderShared,loadShared,DEFAULT_STUBS} from '@liwan/ui/test/helpers/renderShared'
import {errorStateKind} from '@liwan/ui/app/utils/errorState'
import {ApiError} from '../../composables/useApi'
import {projectSectionAvailable} from '../../utils/projectTools'
import * as routes from '../../modules/pmo/projectRoutes'
import {projectSectionLocation} from '../../utils/projectWorkspaceMemory'
import {projectDetail,me} from '../../../stories/fixtures/pmo'
const filename=resolve(import.meta.dirname,'../projects/[id].vue')
const empty={__esModule:true,default:defineComponent({setup:()=>()=>h('div')})}
const pass=defineComponent({inheritAttrs:false,setup:(_, {attrs,slots})=>()=>h('div',attrs,slots.default?.())})
function detail(section:string,enabled=true):ProjectDetail{
 const key=section==='charter'?'governance':'planning'
 return ProjectDetailSchema.parse({...projectDetail,id:7,tools:{...projectDetail.tools,[key]:{...projectDetail.tools[key],enabled}},...(!enabled&&key==='governance'?{charter:null,phase_state:null,phase:null,charter_state:null}:{}),...(!enabled&&key==='planning'?{milestone_count:null}:{})})
}
function view(section:string,status?:number,pending=false){
 const data=ref<ProjectDetail>();const error=ref<unknown>(status?new ApiError(status,status===404?'not_found':status===403?'forbidden':'internal','load failed'):null);const loading=ref(pending)
 const advancedReads=vi.fn();let retry:(()=>void)|undefined
 const refetch=vi.fn(async()=>{data.value=detail(section);error.value=null;loading.value=false;return{data:data.value}})
 const button=defineComponent({inheritAttrs:false,setup:(_, {attrs,slots})=>{if(!attrs.to&&attrs.onClick)retry=attrs.onClick as ()=>void;return()=>h(attrs.to?'a':'button',attrs,slots.default?.())}})
 const options={modules:{
  '@/utils/projectTools':{projectSectionAvailable},'@liwan/ui/app/utils/pageHeaderTag':{statusTag:()=>({label:'status'})},'@/composables/projectStatus':{projectStatusBadge:()=>({tone:'neutral'})},'@liwan/ui/app/utils/statusBadge':{badgeLabel:()=>''},
  '@/components/pmo/projects/ProjectPhaseStepper.vue':empty,'@/components/pmo/projects/workspace/ProjectWorkspaceTabs.vue':empty,'@/components/pmo/projects/ProjectNotFoundState.vue':{__esModule:true,default:loadShared(resolve(import.meta.dirname,'../../components/pmo/projects/ProjectNotFoundState.vue'),{globals:{resolveComponent:()=>pass}})},
  '@/composables/useApi':{ApiError},'@/modules/pmo/projectRoutes':routes,'@/composables/useProjects':{useProject:()=>({data,error,isLoading:loading,refetch})},'@/utils/projectNavigation':{archivedTags:()=>[],projectRecordBack:()=>'/projects'},'@/utils/projectWorkspaceMemory':{projectSectionLocation},'@liwan/ui/app/composables/calendarDate':{formatCalendarDate:(date:string)=>date},'../../../utils/errorState':{errorStateKind},
 },globals:{reactive,useRecordListPaths:()=>ref(['/projects']),useRoute:()=>({path:`/projects/7/${section}`,fullPath:`/projects/7/${section}`,query:{},hash:''}),useRouter:()=>({resolve:()=>({fullPath:'/projects'})}),useMe:()=>({me:ref(me)}),useProjectWorkspaceMemory:()=>({remember:()=>{}}),useEscapeBack:()=>{},provideFrameOwnsHeading:()=>{}},stubs:{...DEFAULT_STUBS,UButton:button,SharedPageContainer:pass,SharedPageState:loadShared('PageState',{modules:{'../../../utils/errorState':{errorStateKind}}}),SharedHeaderTags:pass,UTooltip:pass,NuxtPage:defineComponent({setup:()=>{advancedReads();return()=>h('div',{'data-testid':'advanced-child'})}})}}
 return {data,error,loading,advancedReads,refetch,retry:()=>retry?.(),render:()=>renderShared(filename,{}, {},options)}
}
describe.each(['charter','schedule'])('cold %s parent load recovery',section=>{
 it.each([403,404])('shows the shared inaccessible/not-found answer on%i without mounting tool children',async status=>{
  const v=view(section,status);const html=await v.render();expect(html).toContain('project-not-found');expect(v.advancedReads).not.toHaveBeenCalled()
 })
 it('shows a retryable500 and mounts the tool only after successful refetch',async()=>{
  const v=view(section,500);let html=await v.render();expect(html).toContain('data-slot="error-state"');expect(html).toContain('app.retry');expect(v.advancedReads).not.toHaveBeenCalled()
  v.retry();await nextTick();expect(v.refetch).toHaveBeenCalledOnce();html=await v.render();expect(html).toContain('advanced-child');expect(v.advancedReads).toHaveBeenCalledOnce()
 })
 it('shows pending state, then a confirmed tool denial, without mounting advanced children',async()=>{
  const v=view(section,undefined,true);expect(await v.render()).toContain('loading-skeleton');expect(v.advancedReads).not.toHaveBeenCalled()
  v.data.value=detail(section,false);v.loading.value=false;const html=await v.render();expect(html).toContain('projects.tools.unavailable');expect(v.advancedReads).not.toHaveBeenCalled()
 })
})
