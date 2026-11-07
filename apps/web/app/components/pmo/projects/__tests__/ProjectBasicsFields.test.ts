import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { renderShared } from '@liwan/ui/test/helpers/renderShared'
const filename=resolve(import.meta.dirname,'../ProjectBasicsFields.vue')
const draft={name:'Alpha',description:'Brief',objectives:[{goal:'First goal',metric:'count',target:'20'},{goal:'Second goal',metric:'',target:''}],success_criteria:'20 in one month',user_id:7,date_start:null,date_end:null}
describe('core project fields',()=>{
 it('renders all objective rows without a governance dependency',async()=>{
  const html=await renderShared(filename,{modelValue:draft},{},{globals:{useHydrated:()=>({value:true})}})
  expect(html).toContain('project-objective-0');expect(html).toContain('project-objective-1');expect(html).toContain('project-success-criteria')
 })
 it('exposes an AI-prefilled start date for review',async()=>{
  const html=await renderShared(filename,{modelValue:{...draft,date_start:'2030-02-01',date_end:'2030-03-01'}})
  expect(html).toContain('project-create-start-date');expect(html).toContain('2030-02-01')
 })
 it('shows a company-required end date without opening optional details',async()=>{
  const html=await renderShared(filename,{modelValue:draft,requireEndDate:true})
  expect(html).toContain('project-create-end-date')
 })
})
