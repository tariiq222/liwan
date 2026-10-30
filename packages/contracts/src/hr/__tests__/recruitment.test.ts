import { describe, expect, it } from 'vitest'
import {
  HrApplicantCreateSchema,
  HrApplicantHireResultSchema,
  HrApplicantListSchema,
  HrApplicantPatchSchema,
  HrApplicantRefuseSchema,
  HrApplicantSchema,
  HrRecruitmentJobCreateSchema,
  HrRecruitmentJobListSchema,
  HrRecruitmentJobPatchSchema,
  HrRecruitmentJobSchema,
  HrRecruitmentRefuseReasonListSchema,
  HrRecruitmentStageListSchema,
  HrRecruitmentStageSchema,
} from '..'

const JOB = {
  id: 3,
  name: 'مهندس برمجيات',
  department: { id: 4, name: 'الهندسة' },
  no_of_recruitment: 2,
  application_count: 5,
  description: 'بناء المنصة',
  active: true,
}

const APPLICANT = {
  id: 11,
  partner_name: 'Lina',
  email_from: 'lina@example.com',
  partner_phone: '+966500000000',
  job: { id: 3, name: 'مهندس برمجيات' },
  department: { id: 4, name: 'الهندسة' },
  stage: { id: 1, name: 'New' },
  status: 'ongoing',
  priority: '1',
  availability: '2026-11-01',
  refuse_reason: null,
  employee: null,
  applied_on: '2026-10-01T09:00:00Z',
  active: true,
}

describe('HrRecruitmentJobSchema', () => {
  it('accepts a job list with the LiwanOS applicant count', () => {
    const parsed = HrRecruitmentJobListSchema.parse({ items: [JOB], total: 1 })
    expect(parsed.items[0]?.application_count).toBe(5)
    expect(HrRecruitmentJobSchema.parse(JOB).description).toBe('بناء المنصة')
  })

  it('accepts an empty description, a null department and no openings', () => {
    const parsed = HrRecruitmentJobSchema.parse({
      ...JOB, description: '', department: null, no_of_recruitment: 0, application_count: 0,
    })
    expect(parsed.department).toBeNull()
  })

  it('rejects unknown fields, a negative count and a malformed department', () => {
    expect(() => HrRecruitmentJobSchema.parse({ ...JOB, salary: 1 })).toThrow()
    expect(() => HrRecruitmentJobSchema.parse({ ...JOB, application_count: -1 })).toThrow()
    expect(() => HrRecruitmentJobSchema.parse({ ...JOB, department: { id: 4 } })).toThrow()
    expect(() => HrRecruitmentJobListSchema.parse({ items: [JOB] })).toThrow()
  })
})

describe('recruitment writes', () => {
  it('accepts strict job creates and non-empty patches', () => {
    expect(HrRecruitmentJobCreateSchema.parse({ name: '  مهندس  ', department_id: null }).name).toBe('مهندس')
    expect(HrRecruitmentJobPatchSchema.parse({ active: false })).toEqual({ active: false })
  })

  it('rejects an empty job patch, a blank name and unknown write keys', () => {
    expect(() => HrRecruitmentJobPatchSchema.parse({})).toThrow()
    expect(() => HrRecruitmentJobCreateSchema.parse({ name: '   ' })).toThrow()
    expect(() => HrRecruitmentJobPatchSchema.parse({ no_of_recruitment: -1 })).toThrow()
    expect(() => HrRecruitmentJobCreateSchema.parse({ name: 'Job', salary: 1 })).toThrow()
  })

  it('accepts a strict applicant create and non-empty patches', () => {
    const created = HrApplicantCreateSchema.parse({ partner_name: ' Lina ', job_id: 3, email_from: '' })
    expect(created.email_from).toBe('')
    expect(HrApplicantPatchSchema.parse({ stage_id: 2, priority: '3' })).toEqual({ stage_id: 2, priority: '3' })
    expect(HrApplicantPatchSchema.parse({ availability: null })).toEqual({ availability: null })
  })

  it('rejects an applicant without a job, an empty patch and unknown keys', () => {
    expect(() => HrApplicantCreateSchema.parse({ partner_name: 'Lina' })).toThrow()
    expect(() => HrApplicantPatchSchema.parse({})).toThrow()
    expect(() => HrApplicantPatchSchema.parse({ availability: '01/02/2026' })).toThrow()
    expect(() => HrApplicantCreateSchema.parse({ partner_name: 'Lina', job_id: 3, linkedin_profile: 'x' })).toThrow()
  })
})

describe('HrApplicantSchema', () => {
  it('accepts a hired applicant with its employee link', () => {
    const hired = { ...APPLICANT, status: 'hired', employee: { id: 7, name: 'Lina' } }
    expect(HrApplicantSchema.parse(hired).status).toBe('hired')
    expect(HrApplicantListSchema.parse({ items: [APPLICANT, hired], total: 2 }).total).toBe(2)
  })

  it('rejects an unknown status and every salary field', () => {
    expect(() => HrApplicantSchema.parse({ ...APPLICANT, status: 'pending' })).toThrow()
    expect(() => HrApplicantSchema.parse({ ...APPLICANT, salary_expected: 1000 })).toThrow()
    expect(() => HrApplicantSchema.parse({ ...APPLICANT, extra: true })).toThrow()
  })
})

describe('stages, refuse reasons and hire', () => {
  it('accepts stages and refuse reasons in list envelopes', () => {
    const stage = { id: 1, name: 'New', sequence: 10, hired_stage: false, fold: false }
    expect(HrRecruitmentStageSchema.parse(stage).sequence).toBe(10)
    expect(HrRecruitmentStageListSchema.parse({ items: [stage], total: 1 }).total).toBe(1)
    expect(HrRecruitmentRefuseReasonListSchema.parse({ items: [{ id: 2, name: 'Better offer' }], total: 1 }).items).toHaveLength(1)
  })

  it('accepts a refuse reason id and the hire result', () => {
    expect(HrApplicantRefuseSchema.parse({ refuse_reason_id: 2 }).refuse_reason_id).toBe(2)
    expect(() => HrApplicantRefuseSchema.parse({})).toThrow()
    const result = HrApplicantHireResultSchema.parse({
      applicant: { ...APPLICANT, status: 'hired' },
      employee: { id: 7, name: 'Lina' },
    })
    expect(result.employee.id).toBe(7)
    expect(() => HrApplicantHireResultSchema.parse({ applicant: APPLICANT })).toThrow()
  })
})
