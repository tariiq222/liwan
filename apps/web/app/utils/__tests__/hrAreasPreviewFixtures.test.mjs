import { describe, expect, it } from 'vitest'
import { moduleUiCapabilities, moduleUiPreviewData } from '../../../e2e/module-ui-preview-data.mjs'
import { capabilitiesForRequest } from '../../../e2e/mock-capabilities.mjs'
import {
  HrActivityPlanListSchema, HrActivityPlanSchema, HrApplicantListSchema, HrApplicantSchema, HrAssetCategoryListSchema,
  HrDepartureListSchema, HrDepartureReasonListSchema, HrDepartureSchema, HrEquipmentListSchema, HrEquipmentSchema,
  HrPlanRunDetailSchema, HrPlanRunListSchema, HrRecruitmentJobListSchema, HrRecruitmentJobSchema,
  HrRecruitmentRefuseReasonListSchema, HrRecruitmentStageListSchema, HrShiftAssignmentListSchema, HrShiftScheduleListSchema,
  HrShiftScheduleSchema,
} from '@webvue/contracts'

const at = (path, query = '') => new URL(`http://localhost${path}${query}`)
const serve = (path, query = '') => moduleUiPreviewData(path, at(path, query))
const names = (list, key = 'name') => list.items.map(item => item[key])

describe('the HR area preview fixtures match the production contracts', () => {
  for (const [path, schema] of [
    ['/api/v1/hr/shifts/schedules', HrShiftScheduleListSchema], ['/api/v1/hr/shifts/schedules/1', HrShiftScheduleSchema],
    ['/api/v1/hr/shifts/assignments', HrShiftAssignmentListSchema], ['/api/v1/hr/shifts/me', HrShiftAssignmentListSchema],
    ['/api/v1/hr/assets/categories', HrAssetCategoryListSchema], ['/api/v1/hr/assets/equipment', HrEquipmentListSchema],
    ['/api/v1/hr/assets/equipment/1', HrEquipmentSchema], ['/api/v1/hr/assets/me', HrEquipmentListSchema],
    ['/api/v1/hr/recruitment/jobs', HrRecruitmentJobListSchema], ['/api/v1/hr/recruitment/jobs/1', HrRecruitmentJobSchema],
    ['/api/v1/hr/recruitment/stages', HrRecruitmentStageListSchema], ['/api/v1/hr/recruitment/refuse-reasons', HrRecruitmentRefuseReasonListSchema],
    ['/api/v1/hr/recruitment/applicants', HrApplicantListSchema], ['/api/v1/hr/recruitment/applicants/1', HrApplicantSchema],
    ['/api/v1/hr/onboarding/plans', HrActivityPlanListSchema], ['/api/v1/hr/onboarding/plans/1', HrActivityPlanSchema],
    ['/api/v1/hr/onboarding/runs', HrPlanRunListSchema], ['/api/v1/hr/onboarding/runs/1', HrPlanRunDetailSchema],
    ['/api/v1/hr/offboarding/plans', HrActivityPlanListSchema], ['/api/v1/hr/offboarding/plans/3', HrActivityPlanSchema],
    ['/api/v1/hr/offboarding/runs', HrPlanRunListSchema], ['/api/v1/hr/offboarding/runs/21', HrPlanRunDetailSchema],
    ['/api/v1/hr/offboarding/reasons', HrDepartureReasonListSchema], ['/api/v1/hr/offboarding/departures', HrDepartureListSchema],
    ['/api/v1/hr/offboarding/departures/2', HrDepartureSchema],
  ]) {
    it(path, () => {
      const parsed = schema.safeParse(serve(path))
      expect(parsed.success, JSON.stringify(parsed.error)).toBe(true)
    })
  }

  it('serves every archived and filtered variant through the same schemas', () => {
    for (const [path, query, schema] of [
      ['/api/v1/hr/shifts/schedules', '?active=all', HrShiftScheduleListSchema],
      ['/api/v1/hr/assets/equipment', '?active=all', HrEquipmentListSchema],
      ['/api/v1/hr/recruitment/jobs', '?active=all', HrRecruitmentJobListSchema],
      ['/api/v1/hr/recruitment/applicants', '?status=refused', HrApplicantListSchema],
      ['/api/v1/hr/offboarding/departures', '?cleared=true', HrDepartureListSchema],
    ]) expect(schema.safeParse(serve(path, query)).success, `${path}${query}`).toBe(true)
  })
})

describe('the HR area preview fixtures honour the list filters of the routes', () => {
  it('lists active schedules by default and every schedule with active=all', () => {
    expect(names(serve('/api/v1/hr/shifts/schedules'))).toEqual(['دوام صباحي', 'دوام مسائي'])
    expect(serve('/api/v1/hr/shifts/schedules', '?active=all').total).toBe(3)
    expect(names(serve('/api/v1/hr/shifts/schedules', '?active=false'))).toEqual(['دوام رمضان'])
  })

  it('filters assignments by employee, schedule and the day they cover', () => {
    const employees = query => serve('/api/v1/hr/shifts/assignments', query).items.map(item => item.employee.name)
    expect(employees('?employee_id=2')).toEqual(['خالد الشمري'])
    expect(employees('?schedule_id=1')).toEqual(['سارة محمد', 'منى القحطاني'])
    expect(employees('?on_date=2025-06-01')).toEqual(['منى القحطاني'])
    expect(employees('?on_date=2027-06-01')).toEqual(['سارة محمد', 'منى القحطاني'])
  })

  it('lists active equipment by default and filters it by custody, category, holder and search', () => {
    const list = query => names(serve('/api/v1/hr/assets/equipment', query))
    expect(list('')).toHaveLength(3)
    expect(list('?active=false')).toEqual(['طابعة مكتبية قديمة'])
    expect(list('?assigned=false')).toEqual(['شاشة إل جي 27'])
    expect(list('?assigned=true&employee_id=2')).toEqual(['هاتف آيفون 15'])
    expect(list('?category_id=1')).toEqual(['حاسوب محمول ديل'])
    expect(list('?q=LG-2002')).toEqual(['شاشة إل جي 27'])
  })

  it('serves the custody of the first employee only through /me', () => {
    expect(names(serve('/api/v1/hr/assets/me'))).toEqual(['حاسوب محمول ديل'])
  })

  it('filters applicants by status, job, stage and name, and jobs by active scope', () => {
    const applicants = query => names(serve('/api/v1/hr/recruitment/applicants', query), 'partner_name')
    expect(applicants('')).toHaveLength(4)
    expect(applicants('?status=hired')).toEqual(['فهد المطيري'])
    expect(applicants('?job_id=1')).toEqual(['عبدالله الغامدي', 'ريم السبيعي'])
    expect(applicants('?stage_id=1')).toEqual(['ريم السبيعي', 'هند الزهراني'])
    expect(applicants('?q=هند')).toEqual(['هند الزهراني'])
    expect(names(serve('/api/v1/hr/recruitment/jobs'))).toEqual(['مطور واجهات', 'محلل موارد بشرية'])
    expect(serve('/api/v1/hr/recruitment/jobs', '?active=all').total).toBe(3)
  })

  it('derives the run progress and state from the checklist', () => {
    const runs = serve('/api/v1/hr/onboarding/runs').items
    expect(runs.map(run => [run.done, run.total, run.state])).toEqual([[1, 3, 'open'], [1, 1, 'done']])
    expect(serve('/api/v1/hr/onboarding/runs', '?state=done').items.map(run => run.employee.name)).toEqual(['خالد الشمري'])
    expect(runs.every(run => !('steps' in run))).toBe(true)
  })

  it('filters departures by clearance and links the clearance to an offboarding run', () => {
    const employees = query => serve('/api/v1/hr/offboarding/departures', query).items.map(item => item.employee.name)
    expect(employees('?cleared=true')).toEqual(['ليلى الدوسري'])
    expect(employees('?cleared=false')).toEqual(['خالد الشمري', 'منى القحطاني'])
    expect(employees('?q=منى')).toEqual(['منى القحطاني'])
    const departure = serve('/api/v1/hr/offboarding/departures/2')
    expect(serve(`/api/v1/hr/offboarding/runs/${departure.clearance.run_id}`).employee.name).toBe('خالد الشمري')
  })

  it('answers undefined for an unknown id', () => {
    for (const path of ['/api/v1/hr/shifts/schedules/99', '/api/v1/hr/assets/equipment/99', '/api/v1/hr/recruitment/applicants/99', '/api/v1/hr/onboarding/runs/99', '/api/v1/hr/offboarding/departures/99'])
      expect(serve(path), path).toBeUndefined()
  })
})

describe('the HR area capabilities of the mock', () => {
  const areas = ['shifts', 'assets', 'recruitment', 'onboarding', 'offboarding']
  it('grants read and manage for every area', () => {
    for (const area of areas) expect(moduleUiCapabilities).toEqual(expect.arrayContaining([`hr.${area}.read`, `hr.${area}.manage`]))
  })
  it('leaves a reader only the read capabilities', () => {
    const reader = capabilitiesForRequest('mock_caps=reader', moduleUiCapabilities)
    for (const area of areas) {
      expect(reader).toContain(`hr.${area}.read`)
      expect(reader).not.toContain(`hr.${area}.manage`)
    }
  })
})
