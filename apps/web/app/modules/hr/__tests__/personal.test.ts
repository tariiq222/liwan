import { describe, expect, it } from 'vitest'
import manifest from '../manifest'

describe('HR personal contributions', () => {
  it('contributes every own HR destination without a mine administration section', () => {
    expect(manifest.personal?.map(entry => entry.to)).toEqual(['/account/profile','/account/leave','/account/pay','/account/assets','/account/schedule'])
    expect(manifest.contextLinks?.('/hr').some(link => link.id === 'section-mine')).toBe(false)
    expect(manifest.services).toBeUndefined()
  })
  it('preserves independent feature gates for own assets, payroll and shifts', () => {
    expect(manifest.personal?.find(entry => entry.section === 'pay')?.feature).toBe('hr.payroll')
    expect(manifest.personal?.find(entry => entry.section === 'assets')?.feature).toBe('hr.assets')
    expect(manifest.personal?.find(entry => entry.section === 'schedule')?.feature).toBe('hr.shifts')
    expect(manifest.personal?.find(entry => entry.section === 'leave')?.primaryAction).toMatchObject({to:'/account/leave/new', capability:'hr.leave.request'})
  })
  it('requires either leave management or approval authority on the administrative list', () => {
    expect(manifest.routeCapabilities?.find(rule => rule.pattern.test('/hr/leave'))).toMatchObject({capability:'hr.leave.read',anyCapabilities:['hr.leave.approve','hr.leave.manage']})
  })
})

const employee = { id: 4, name: 'Sara', job_title: 'HR specialist', department: {id:2,name:'People'}, work_email:'sara@example.com', work_phone:'', user_id:2, manager:null, active:true, access:null, contract:null }
const translate = (key: string) => key

describe('HR overview privacy and ownership', () => {
  it('shows approved payslip references without copying any salary amount into the overview', async () => {
    const calls: string[] = []
    const api = (async (path: string, options: any) => {
      calls.push(path)
      return options.schema.parse(path === '/api/v1/hr/me' ? employee : {items:[{id:7,number:'PAY-7',month:'2026-10',net:12345}],total:1})
    }) as import('../../types').AppSearchApi
    const summary = await manifest.personal!.find(entry => entry.section === 'pay')!.summary!.load(api,translate)
    expect(calls).toEqual(['/api/v1/hr/me','/api/v1/hr/payroll/payslips/mine'])
    expect(summary.rows).toEqual([{id:7,label:'2026-10',to:'/account/pay/7'}])
    expect(JSON.stringify(summary)).not.toContain('12345')
  })
  it('explains missing employee linkage without querying leave, assets, pay or shifts', async () => {
    for (const entry of manifest.personal!) {
      const calls: string[] = []
      const api = (async (path: string, options: any) => {calls.push(path); return options.schema.parse(null)}) as import('../../types').AppSearchApi
      expect(await entry.summary!.load(api,translate)).toEqual({caption:'hr.self.noEmployeeHint'})
      expect(calls).toEqual(['/api/v1/hr/me'])
    }
  })
  it('queries only own leave and links to the own detail endpoint destination', async () => {
    const leave = {id:9,employee:{id:4,name:'Sara'},leave_type:{id:2,name:'Annual'},date_from:'2026-11-01',date_to:'2026-11-02',number_of_days:2,state:'confirm',notes:'',can_approve:false,can_refuse:false,can_withdraw:true,can_cancel:false}
    const calls: Array<{path:string,query:unknown}> = []
    const api = (async (path: string, options: any) => {
      calls.push({path,query:options.query})
      return options.schema.parse(path === '/api/v1/hr/me' ? employee : path.endsWith('balances') ? {items:[],total:0} : {items:[leave],total:1})
    }) as import('../../types').AppSearchApi
    const summary = await manifest.personal!.find(entry => entry.section === 'leave')!.summary!.load(api,translate)
    expect(calls[2]).toEqual({path:'/api/v1/hr/leave/requests',query:{mine:'1',limit:3,offset:0}})
    expect(summary.rows).toEqual([{id:9,label:'Annual',to:'/account/leave/9',caption:'hr.leave.state.confirm'}])
  })
})
