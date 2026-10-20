import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/vue-query'
import {
  HrApplicantHireResultSchema,
  HrApplicantListSchema,
  HrApplicantSchema,
  HrRecruitmentJobListSchema,
  HrRecruitmentJobSchema,
  HrRecruitmentRefuseReasonListSchema,
  HrRecruitmentStageListSchema,
  type HrApplicant,
  type HrApplicantCreate,
  type HrApplicantPatch,
  type HrApplicantStatus,
  type HrRecruitmentJob,
  type HrRecruitmentJobCreate,
  type HrRecruitmentJobPatch,
  type HrRecruitmentStage,
} from '@webvue/contracts'
import type { StatusBadgeEntry } from '@webvue/ui/app/utils/statusBadge'

type Api = ReturnType<typeof useApi>['$api']

/** The page size the applicant and job lists ask for; the server caps it at 200. */
export const HR_RECRUITMENT_PAGE_SIZE = 25
const MAX_LIMIT = 100

export const hrRecruitmentKeys = {
  all: ['hr', 'recruitment'] as const,
  jobs: (query: HrRecruitmentJobQuery) => ['hr', 'recruitment', 'jobs', query] as const,
  job: (id: number) => ['hr', 'recruitment', 'job', id] as const,
  stages: (jobId: number | null) => ['hr', 'recruitment', 'stages', jobId] as const,
  refuseReasons: ['hr', 'recruitment', 'refuse-reasons'] as const,
  applicants: (query: HrApplicantQuery) => ['hr', 'recruitment', 'applicants', query] as const,
  applicant: (id: number) => ['hr', 'recruitment', 'applicant', id] as const,
}

export type HrRecruitmentActiveFilter = 'true' | 'false' | 'all'
/** `all` shows every applicant, active and archived, without a status domain. */
export type HrApplicantStatusFilter = HrApplicantStatus | 'all'

export interface HrRecruitmentJobQuery {
  q?: string
  department_id?: number
  active?: HrRecruitmentActiveFilter
  limit?: number
  offset?: number
}

export interface HrApplicantQuery {
  q?: string
  job_id?: number
  stage_id?: number
  status?: HrApplicantStatus
  limit?: number
  offset?: number
}

export interface HrRecruitmentJobInput {
  q?: string
  departmentId?: number | null
  active?: HrRecruitmentActiveFilter
  limit?: number
  offset?: number
}

export interface HrApplicantInput {
  q?: string
  jobId?: number | null
  stageId?: number | null
  status?: HrApplicantStatusFilter
  limit?: number
  offset?: number
}

function page(input: { limit?: number; offset?: number }) {
  // A missing, zero or negative limit is the route default, exactly like the server's parse_page.
  const asked = input.limit
  const limit = Number.isFinite(asked) && (asked as number) > 0
    ? Math.min(Math.trunc(asked as number), MAX_LIMIT)
    : HR_RECRUITMENT_PAGE_SIZE
  const offset = Number.isInteger(input.offset) && (input.offset as number) > 0 ? (input.offset as number) : 0
  return { limit, offset }
}

/** The query string of one job-position list request; empty values are dropped, not sent blank. */
export function hrJobQuery(input: HrRecruitmentJobInput): HrRecruitmentJobQuery {
  return {
    q: input.q?.trim() || undefined,
    department_id: input.departmentId ?? undefined,
    active: input.active ?? undefined,
    ...page(input),
  }
}

/** The query string of one applicant list request. */
export function hrApplicantQuery(input: HrApplicantInput): HrApplicantQuery {
  return {
    q: input.q?.trim() || undefined,
    job_id: input.jobId ?? undefined,
    stage_id: input.stageId ?? undefined,
    status: input.status && input.status !== 'all' ? input.status : undefined,
    ...page(input),
  }
}

const APPLICANT_STATUS_TONE: Record<HrApplicantStatus, StatusBadgeEntry['tone']> = {
  ongoing: 'info',
  hired: 'success',
  refused: 'destructive',
  archived: 'neutral',
}

/** An applicant's status: in progress, hired, refused or archived. */
export function hrApplicantBadge(status: HrApplicantStatus): StatusBadgeEntry {
  return { tone: APPLICANT_STATUS_TONE[status], labelKey: `hrRecruitment.status.${status}` }
}

export const HR_APPLICANT_PRIORITIES = ['0', '1', '2', '3'] as const

export type HrApplicantPriority = (typeof HR_APPLICANT_PRIORITIES)[number]

export function hrApplicantPriorityKey(priority: string) {
  return `hrRecruitment.priority.${priority}`
}

/** A write answers with the full detail shape: replace it in the cache, then refresh the lists. */
function replaceApplicant(qc: QueryClient, applicant: HrApplicant) {
  qc.setQueryData(hrRecruitmentKeys.applicant(applicant.id), applicant)
  // The job card counts ongoing applicants, so it changes with any applicant write.
  void qc.invalidateQueries({ queryKey: ['hr', 'recruitment', 'applicants'] })
  void qc.invalidateQueries({ queryKey: ['hr', 'recruitment', 'jobs'] })
}

function replaceJob(qc: QueryClient, job: HrRecruitmentJob) {
  qc.setQueryData(hrRecruitmentKeys.job(job.id), job)
  void qc.invalidateQueries({ queryKey: ['hr', 'recruitment', 'jobs'] })
}

export async function createHrRecruitmentJob($api: Api, qc: QueryClient, body: HrRecruitmentJobCreate) {
  const job = await $api('/api/v1/hr/recruitment/jobs', { method: 'POST', body, schema: HrRecruitmentJobSchema })
  replaceJob(qc, job)
  return job
}

export async function updateHrRecruitmentJob($api: Api, qc: QueryClient, { id, body }: { id: number; body: HrRecruitmentJobPatch }) {
  const job = await $api(`/api/v1/hr/recruitment/jobs/${id}`, { method: 'PATCH', body, schema: HrRecruitmentJobSchema })
  replaceJob(qc, job)
  return job
}

export async function createHrApplicant($api: Api, qc: QueryClient, body: HrApplicantCreate) {
  const applicant = await $api('/api/v1/hr/recruitment/applicants', { method: 'POST', body, schema: HrApplicantSchema })
  replaceApplicant(qc, applicant)
  return applicant
}

export async function updateHrApplicant($api: Api, qc: QueryClient, { id, body }: { id: number; body: HrApplicantPatch }) {
  const applicant = await $api(`/api/v1/hr/recruitment/applicants/${id}`, { method: 'PATCH', body, schema: HrApplicantSchema })
  replaceApplicant(qc, applicant)
  return applicant
}

export async function refuseHrApplicant($api: Api, qc: QueryClient, { id, refuseReasonId }: { id: number; refuseReasonId: number }) {
  const applicant = await $api(`/api/v1/hr/recruitment/applicants/${id}/refuse`, {
    method: 'POST', body: { refuse_reason_id: refuseReasonId }, schema: HrApplicantSchema,
  })
  replaceApplicant(qc, applicant)
  return applicant
}

export async function resetHrApplicant($api: Api, qc: QueryClient, id: number) {
  const applicant = await $api(`/api/v1/hr/recruitment/applicants/${id}/reset`, {
    method: 'POST', body: {}, schema: HrApplicantSchema,
  })
  replaceApplicant(qc, applicant)
  return applicant
}

/** Hiring creates an hr.employee as well, so the employee lists are refreshed too. */
export async function hireHrApplicant($api: Api, qc: QueryClient, id: number) {
  const result = await $api(`/api/v1/hr/recruitment/applicants/${id}/hire`, {
    method: 'POST', body: {}, schema: HrApplicantHireResultSchema,
  })
  replaceApplicant(qc, result.applicant)
  void qc.invalidateQueries({ queryKey: ['hr', 'employees'] })
  return result
}

export function useHrRecruitmentJobList(input: MaybeRefOrGetter<HrRecruitmentJobInput>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrRecruitmentKeys.jobs(hrJobQuery(toValue(input)))),
    enabled: computed(() => can('hr.recruitment.read')),
    queryFn: () => $api('/api/v1/hr/recruitment/jobs', {
      query: { ...hrJobQuery(toValue(input)) },
      schema: HrRecruitmentJobListSchema,
    }),
  })
}

export function useHrRecruitmentJob(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrRecruitmentKeys.job(toValue(id) ?? 0)),
    enabled: computed(() => can('hr.recruitment.read') && !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/recruitment/jobs/${toValue(id)}`, { schema: HrRecruitmentJobSchema }),
  })
}

export function useHrRecruitmentStages(jobId: MaybeRefOrGetter<number | null> = null) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrRecruitmentKeys.stages(toValue(jobId))),
    enabled: computed(() => can('hr.recruitment.read')),
    queryFn: () => $api('/api/v1/hr/recruitment/stages', {
      query: { job_id: toValue(jobId) ?? undefined },
      schema: HrRecruitmentStageListSchema,
    }),
  })
}

export function useHrRecruitmentRefuseReasons() {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: hrRecruitmentKeys.refuseReasons,
    enabled: computed(() => can('hr.recruitment.read')),
    queryFn: () => $api('/api/v1/hr/recruitment/refuse-reasons', { schema: HrRecruitmentRefuseReasonListSchema }),
  })
}

export function useHrRecruitmentApplicants(input: MaybeRefOrGetter<HrApplicantInput>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrRecruitmentKeys.applicants(hrApplicantQuery(toValue(input)))),
    enabled: computed(() => can('hr.recruitment.read')),
    queryFn: () => $api('/api/v1/hr/recruitment/applicants', {
      query: { ...hrApplicantQuery(toValue(input)) },
      schema: HrApplicantListSchema,
    }),
  })
}

export function useHrRecruitmentApplicant(id: MaybeRefOrGetter<number | null>) {
  const { $api } = useApi()
  const { can } = useAccess()
  return useQuery({
    queryKey: computed(() => hrRecruitmentKeys.applicant(toValue(id) ?? 0)),
    enabled: computed(() => can('hr.recruitment.read') && !!toValue(id)),
    queryFn: () => $api(`/api/v1/hr/recruitment/applicants/${toValue(id)}`, { schema: HrApplicantSchema }),
  })
}

export function useCreateHrRecruitmentJob() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrRecruitmentJobCreate) => createHrRecruitmentJob($api, qc, body) })
}

export function useUpdateHrRecruitmentJob() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrRecruitmentJobPatch }) => updateHrRecruitmentJob($api, qc, { id, body }) })
}

export function useCreateHrApplicant() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (body: HrApplicantCreate) => createHrApplicant($api, qc, body) })
}

export function useUpdateHrApplicant() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, body }: { id: number; body: HrApplicantPatch }) => updateHrApplicant($api, qc, { id, body }) })
}

export function useRefuseHrApplicant() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: ({ id, refuseReasonId }: { id: number; refuseReasonId: number }) => refuseHrApplicant($api, qc, { id, refuseReasonId }) })
}

export function useResetHrApplicant() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (id: number) => resetHrApplicant($api, qc, id) })
}

export function useHireHrApplicant() {
  const qc = useQueryClient()
  const { $api } = useApi()
  return useMutation({ mutationFn: (id: number) => hireHrApplicant($api, qc, id) })
}

// HrRef is not re-exported: Nuxt auto-imports every composable export, so a second owner
// of the name would break the auto-import map. Import it from @webvue/contracts.
export type { HrApplicant, HrRecruitmentJob, HrRecruitmentStage }
