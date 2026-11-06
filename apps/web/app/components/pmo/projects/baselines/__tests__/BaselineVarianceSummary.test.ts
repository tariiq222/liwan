import {resolve} from 'node:path'
import {defineComponent,h} from 'vue'
import {describe,expect,it} from 'vitest'
import {BaselineVarianceSchema} from '@liwan/contracts'
import {renderShared} from '@liwan/ui/test/helpers/renderShared'
import {formatMoney} from '../../../../../utils/projectFinance'
import * as variance from '../variance'
const filename=resolve(import.meta.dirname,'../BaselineVarianceSummary.vue')
const schedule={project:{baseline_start:'2030-01-01',baseline_end:'2030-02-01',current_start:'2030-01-01',current_end:'2030-02-06',start_variance_days:0,end_variance_days:5},tasks:[],hidden_count:0,late_count:2,early_count:0,undated_count:1,removed_count:0,added_count:0}
const cost={currency:null,baseline_budget:100,current_budget:120,budget_variance:20,actual:80,remaining_against_baseline:20,over_baseline:false}
const panel=defineComponent({props:['title'],setup:(props,{slots})=>()=>h('section',[h('h2',props.title),slots.default?.()])})
const pass=defineComponent({setup:(_, {slots})=>()=>h('div',slots.default?.())})
const row=defineComponent({props:['label','value'],setup:(props,{slots})=>()=>h('div',[props.label,props.value,slots.default?.()])})
async function render(scheduleData:typeof schedule|null,costData:typeof cost|null){
 const data=BaselineVarianceSchema.parse({project_id:7,baseline:{number:1,taken_at:'2030-01-01'},schedule:scheduleData,cost:costData})
 return renderShared(filename,{variance:data},{},{modules:{'@/utils/projectFinance':{formatMoney},'./variance':variance},stubs:{SharedRecordSection:panel,SharedPropertiesPanel:pass,SharedPropertyRow:row},messages:{'projects.baselines.variance.scheduleTitle':'Schedule baseline {number}','projects.baselines.variance.costTitle':'Cost variance'}})
}
describe('independent baseline tool summaries',()=>{
 it('keeps schedule dates and counts when planning is available but finance is unavailable',async()=>{
  const html=await render(schedule,null)
  expect(html).toContain('Schedule baseline 1');expect(html).toContain('2030-02-06');expect(html).toContain('projects.baselines.variance.late2')
  expect(html).not.toContain('Cost variance');expect(html).not.toContain('baselineBudget')
 })
 it('keeps both panels when both tools are available',async()=>{const html=await render(schedule,cost);expect(html).toContain('Schedule baseline 1');expect(html).toContain('Cost variance')})
 it('does not make a readable cost summary depend on schedule visibility',async()=>{const html=await render(null,cost);expect(html).toContain('Cost variance');expect(html).not.toContain('Schedule baseline')})
})
