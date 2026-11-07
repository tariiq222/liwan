import {resolve} from 'node:path'
import {ref,defineComponent,h} from 'vue'
import {describe,expect,it,vi} from 'vitest'
import * as dates from '@internationalized/date'
import {renderShared} from '@liwan/ui/test/helpers/renderShared'
import {taskDetail} from '../../../../../stories/fixtures/pmo'
import {validateTaskDates} from '../../../../utils/projectDateBounds'
const child={__esModule:true,default:defineComponent({setup:()=>()=>h('div')})}
describe('task core properties without planning',()=>{
 it('keeps the ordinary deadline and suppresses project and milestone reads',async()=>{
  const queries:any[]=[]
  const html=await renderShared(resolve(import.meta.dirname,'../TaskProperties.vue'),{task:{...taskDetail(),planning_enabled:false}}, {}, {modules:{
   '@internationalized/date':dates,
   '@/utils/listFormat':{joinList:(values:string[])=>values.join(',')},
   '@liwan/ui/app/composables/calendarDate':{formatLiwanDate:()=>'',formatLiwanDateTime:()=>''},
   '@/composables/usePersonalStages':{usePersonalStages:()=>({data:ref([])})},
   '@/composables/useTasks':{useUpdateTask:()=>({mutate:vi.fn()})},
   '@/composables/useMilestones':{useMilestones:(id:any)=>{queries.push(id);return{data:ref([])}}},
   '@/composables/useProjects':{useProject:(id:any)=>{queries.push(id);return{data:ref(undefined)}}},
   '@/utils/projectDateBounds':{validateTaskDates},
   './AssigneePicker.vue':child,'./MilestoneSelect.vue':child,'./PrioritySelect.vue':child,'@/components/shared/form/TagPicker.vue':child,
  }})
  expect(queries.map(query=>query.value)).toEqual([null,null])
  expect(html).toContain('task-deadline')
  expect(html).not.toContain('task-milestone-label')
 })
})
