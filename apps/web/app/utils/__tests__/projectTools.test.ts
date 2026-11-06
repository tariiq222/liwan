import { describe, expect, it } from 'vitest'
import { optionalProjectTools, sectionToolRequirements, projectSectionAvailable } from '../projectTools'
const tools = { planning: {policy:'enabled',enabled:true,can_toggle:false}, governance:{policy:'optional',enabled:false,can_toggle:true}, finance:{policy:'disabled',enabled:false,can_toggle:false} } as const

describe('project tool policy', () => {
  it('offers only optional preferences', () => expect(optionalProjectTools(tools)).toEqual(['governance']))
  it('owns baseline in planning and EVM in planning plus finance', () => {
    expect(sectionToolRequirements('baselines')).toEqual(['planning'])
    expect(sectionToolRequirements('evm')).toEqual(['planning','finance'])
  })
  it('refuses direct tool routes but keeps core work available', () => {
    expect(projectSectionAvailable('governance', tools)).toBe(false)
    expect(projectSectionAvailable('finance', tools)).toBe(false)
    expect(projectSectionAvailable('tasks', tools)).toBe(true)
    expect(projectSectionAvailable('planning', tools)).toBe(true)
  })
  it('does not reveal tools before project metadata arrives', () => expect(projectSectionAvailable('planning', undefined)).toBe(false))
})

describe('each company tool policy',()=>{
 it.each(['planning','governance','finance'] as const)('shows only optional %s switches',key=>{
  for(const policy of ['enabled','optional','disabled'] as const){
   const state={...tools,[key]:{policy,enabled:policy==='enabled',can_toggle:policy==='optional'}}
   expect(optionalProjectTools(state).includes(key)).toBe(policy==='optional')
   expect(projectSectionAvailable(key,state)).toBe(policy==='enabled')
  }
 })
})
