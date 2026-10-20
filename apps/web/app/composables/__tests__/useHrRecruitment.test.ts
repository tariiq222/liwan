import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/vue-query'
import type { HrApplicant, HrRecruitmentJob } from '@webvue/contracts'
import {
  createHrApplicant,
  hireHrApplicant,
  hrApplicantBadge,
  hrApplicantPriorityKey,
  hrApplicantQuery,
  hrJobQuery,
  hrRecruitmentKeys,
  refuseHrApplicant,
  resetHrApplicant,
  updateHrRecruitmentJob,
} from '../useHrRecruitment'

function job(over: Partial<HrRecruitmentJob> = {}): HrRecruitmentJob {
  return {
    id: 3, name: 'Backend Engineer', department: { id: 1, name: 'Engineering' }, no_of_recruitment: 2,
    application_count: 1, description: '', active: true,
    ...over,
  } as HrRecruitmentJob
}

function applicant(over: Partial<HrApplicant> = {}): HrApplicant {
  return {
    id: 7, partner_name: 'Layla', email_from: 'layla@example.com', partner_phone: '',
    job: { id: 3, name: 'Backend Engineer' }, department: { id: 1, name: 'Engineering' },
    stage: { id: 11, name: 'New' }, status: 'ongoing', priority: '0', availability: null,
    refuse_reason: null, employee: null, applied_on: '2026-10-19T00:00:00Z', active: true,
    ...over,
  } as HrApplicant
}

describe('hrRecruitmentKeys', () => {
  it('keeps one stable root per resource under hr/recruitment', () => {
    expect(hrRecruitmentKeys.all).toEqual(['hr', 'recruitment'])
    expect(hrRecruitmentKeys.job(3)).toEqual(['hr', 'recruitment', 'job', 3])
    expect(hrRecruitmentKeys.applicant(7)).toEqual(['hr', 'recruitment', 'applicant', 7])
    expect(hrRecruitmentKeys.stages(null)).toEqual(['hr', 'recruitment', 'stages', null])
    expect(hrRecruitmentKeys.stages(3)).toEqual(['hr', 'recruitment', 'stages', 3])
    expect(hrRecruitmentKeys.refuseReasons).toEqual(['hr', 'recruitment', 'refuse-reasons'])
    expect(hrRecruitmentKeys.applicants({ limit: 25, offset: 0 })).toEqual([
      'hr', 'recruitment', 'applicants', { limit: 25, offset: 0 },
    ])
  })
})

describe('the list query builders', () => {
  it('drops empty values, keeps the area filters and clamps paging', () => {
    expect(hrApplicantQuery({ q: '  ', jobId: null, stageId: null, status: 'all' })).toEqual({
      q: undefined, job_id: undefined, stage_id: undefined, status: undefined, limit: 25, offset: 0,
    })
    expect(hrApplicantQuery({ q: ' layla ', jobId: 3, stageId: 11, status: 'refused', limit: 500, offset: -4 })).toEqual({
      q: 'layla', job_id: 3, stage_id: 11, status: 'refused', limit: 100, offset: 0,
    })
    expect(hrApplicantQuery({ limit: 10, offset: 20 })).toMatchObject({ limit: 10, offset: 20 })
    expect(hrJobQuery({ q: ' ', departmentId: null, active: 'all' })).toEqual({
      q: undefined, department_id: undefined, active: 'all', limit: 25, offset: 0,
    })
    expect(hrJobQuery({ limit: 0, offset: 5 })).toMatchObject({ limit: 25, offset: 5 })
  })
})

describe('hrApplicantBadge', () => {
  it('maps every applicant status to its tone and locale key', () => {
    expect(hrApplicantBadge('ongoing')).toEqual({ tone: 'info', labelKey: 'hrRecruitment.status.ongoing' })
    expect(hrApplicantBadge('hired')).toEqual({ tone: 'success', labelKey: 'hrRecruitment.status.hired' })
    expect(hrApplicantBadge('refused')).toEqual({ tone: 'destructive', labelKey: 'hrRecruitment.status.refused' })
    expect(hrApplicantBadge('archived')).toEqual({ tone: 'neutral', labelKey: 'hrRecruitment.status.archived' })
    expect(hrApplicantPriorityKey('2')).toBe('hrRecruitment.priority.2')
  })
})

describe('the recruitment writes', () => {
  it('replaces the applicant detail and refreshes the applicant and job lists', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const created = applicant({ id: 9, partner_name: 'Omar' })
    const api = vi.fn().mockResolvedValue(created)
    const body = { partner_name: 'Omar', job_id: 3 }
    await createHrApplicant(api, qc, body)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/recruitment/applicants', {
      method: 'POST', body, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrRecruitmentKeys.applicant(9))).toEqual(created)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hr', 'recruitment', 'applicants'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hr', 'recruitment', 'jobs'] })
  })

  it('posts the refuse reason and the empty bodies of reset and hire', async () => {
    for (const [run, path, body] of [
      [(api: never, qc: QueryClient) => refuseHrApplicant(api, qc, { id: 7, refuseReasonId: 5 }), '/api/v1/hr/recruitment/applicants/7/refuse', { refuse_reason_id: 5 }],
      [(api: never, qc: QueryClient) => resetHrApplicant(api, qc, 7), '/api/v1/hr/recruitment/applicants/7/reset', {}],
    ] as const) {
      const qc = new QueryClient()
      const api = vi.fn().mockResolvedValue(applicant())
      await run(api as never, qc)
      expect(api).toHaveBeenCalledWith(path, { method: 'POST', body, schema: expect.anything() })
      expect(qc.getQueryData(hrRecruitmentKeys.applicant(7))).toEqual(applicant())
    }
  })

  it('caches the hire answer and refreshes the employee lists', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const employee = { id: 21, name: 'Layla' }
    const hired = { applicant: applicant({ employee, status: 'hired' }), employee }
    const api = vi.fn().mockResolvedValue(hired)
    const result = await hireHrApplicant(api, qc, 7)
    expect(api).toHaveBeenCalledWith('/api/v1/hr/recruitment/applicants/7/hire', {
      method: 'POST', body: {}, schema: expect.anything(),
    })
    expect(result).toEqual(hired)
    expect(qc.getQueryData(hrRecruitmentKeys.applicant(7))).toEqual(hired.applicant)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hr', 'employees'] })
  })

  it('replaces the job detail on a patch', async () => {
    const qc = new QueryClient()
    const spy = vi.spyOn(qc, 'invalidateQueries')
    const patched = job({ name: 'Senior Engineer' })
    const api = vi.fn().mockResolvedValue(patched)
    await updateHrRecruitmentJob(api, qc, { id: 3, body: { name: 'Senior Engineer' } })
    expect(api).toHaveBeenCalledWith('/api/v1/hr/recruitment/jobs/3', {
      method: 'PATCH', body: { name: 'Senior Engineer' }, schema: expect.anything(),
    })
    expect(qc.getQueryData(hrRecruitmentKeys.job(3))).toEqual(patched)
    expect(spy).toHaveBeenCalledWith({ queryKey: ['hr', 'recruitment', 'jobs'] })
  })
})
