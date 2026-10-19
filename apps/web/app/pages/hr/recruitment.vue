<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import RecordNumber from '@webvue/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@webvue/ui/app/utils/recordNumberHeader'
import { returnToQuery } from '@webvue/ui/app/utils/safeReturnTo'
import {
  HR_RECRUITMENT_PAGE_SIZE,
  hrApplicantBadge,
  hrApplicantPriorityKey,
  type HrApplicant,
  type HrApplicantStatusFilter,
} from '@/composables/useHrRecruitment'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_RECRUITMENT_PAGE_SIZE
// The applicants list is this page's own screen; it also stays behind its create panel
// (`SharedCreatePanel` is a route-backed panel over the list it was opened from). The
// job-position pages and the applicant record are full pages of their own, so the list
// is not drawn under them.
const isListRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/recruitment' || path === '/hr/recruitment/new'
})
const canManage = computed(() => can('hr.recruitment.manage'))
const canReadJobs = computed(() => can('hr.recruitment.read'))

const STATUS_FILTERS: HrApplicantStatusFilter[] = ['all', 'ongoing', 'hired', 'refused', 'archived']

function positiveParam(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}
function statusParam(value: unknown): HrApplicantStatusFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return STATUS_FILTERS.find(candidate => candidate === raw) ?? 'all'
}

const search = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const jobId = computed(() => positiveParam(route.query.job_id))
const stageId = computed(() => positiveParam(route.query.stage_id))
const status = computed(() => statusParam(route.query.status))
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const applicants = useHrRecruitmentApplicants(computed(() => ({
  q: search.value,
  jobId: jobId.value,
  stageId: stageId.value,
  status: status.value,
  limit: LIMIT,
  offset: offset.value,
})))
// The filter selects read the same catalogs the API does: the active jobs of the company
// and the stages of the selected job (or every stage when none is selected).
const jobs = useHrRecruitmentJobList(computed(() => ({ active: 'true' as const, limit: 100 })))
const stages = useHrRecruitmentStages(computed(() => jobId.value))

const items = computed(() => applicants.data.value?.items ?? [])
const total = computed(() => applicants.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !applicants.isLoading.value && !applicants.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [search.value.trim(), jobId.value, stageId.value, status.value === 'all' ? null : status.value].filter(Boolean).length)

const jobOptions = computed(() => (jobs.data.value?.items ?? []).map(job => ({ value: String(job.id), label: job.name })))
const stageOptions = computed(() => (stages.data.value?.items ?? []).map(stage => ({ value: String(stage.id), label: stage.name })))
const statusOptions = computed(() => STATUS_FILTERS.map(status => ({
  value: status,
  label: t(`hrRecruitment.statusFilter.${status}`),
  testId: `hr-recruitment-status-${status}`,
})))

const columns = computed<TableColumn<HrApplicant>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'partner_name', header: t('hrRecruitment.columns.applicant') },
  { accessorKey: 'job', header: t('hrRecruitment.columns.job') },
  { accessorKey: 'stage', header: t('hrRecruitment.columns.stage') },
  { accessorKey: 'status', header: t('hrRecruitment.columns.status') },
  { accessorKey: 'priority', header: t('hrRecruitment.columns.priority'), meta: { class: { th: 'w-[92px]', td: 'w-[92px]' } } },
])

function writeQuery(patch: Partial<{ q: string; job: number | null; stage: number | null; status: HrApplicantStatusFilter; offset: number }>) {
  if (!hydrated.value) return
  const nextStatus = patch.status ?? status.value
  void router.replace({
    query: {
      ...route.query,
      q: (patch.q ?? search.value).trim() || undefined,
      job_id: (patch.job !== undefined ? patch.job : jobId.value) ?? undefined,
      stage_id: (patch.stage !== undefined ? patch.stage : stageId.value) ?? undefined,
      status: nextStatus === 'all' ? undefined : nextStatus,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || applicants.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}
function clearFilters() {
  void router.replace({ query: { ...route.query, q: undefined, job_id: undefined, stage_id: undefined, status: undefined, offset: undefined }, hash: route.hash })
}

const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canManage.value ? { path: '/hr/recruitment/new', query: listQuery.value } : undefined)
// The job-position list is a sibling list with its own filters: it carries no list state.
const jobsTo = computed(() => ({ path: '/hr/recruitment/jobs' }))
function applicantTo(applicant: HrApplicant) {
  return { path: `/hr/recruitment/${applicant.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage
    v-if="isListRoute"
    :title="t('nav.recruitment')"
    :description="t('hrRecruitment.description')"
    :create-to="createTo"
    :create-label="t('hrRecruitment.newApplicant')"
    create-test-id="hr-recruitment-new"
  >
    <template v-if="canReadJobs" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-briefcase" :to="jobsTo" :disabled="!hydrated" :label="t('hrRecruitment.jobs.title')" data-testid="hr-recruitment-jobs" />
    </template>

    <SharedListCard>
      <template #filters>
        <div class="webvue-page-stack">
          <SharedSegmentedControl
            :model-value="status"
            :items="statusOptions"
            :label="t('hrRecruitment.columns.status')"
            :disabled="!hydrated"
            @update:model-value="writeQuery({ status: statusParam($event), offset: 0 })"
          />
          <SharedFilterBar
            embedded
            class="w-full"
            :active-count="activeFilterCount"
            :disabled="!hydrated"
            @clear="clearFilters"
          >
            <template #search>
              <UInput
                :model-value="search"
                class="min-w-48 flex-1"
                icon="i-lucide-search"
                :disabled="!hydrated"
                :aria-label="t('hrRecruitment.searchApplicants')"
                :placeholder="t('hrRecruitment.searchApplicants')"
                data-testid="hr-recruitment-search"
                @update:model-value="writeQuery({ q: String($event ?? ''), offset: 0 })"
              />
            </template>
            <SharedFilterField :label="t('hrRecruitment.columns.job')" for="hr-recruitment-job">
              <USelect
                id="hr-recruitment-job"
                class="w-full"
                :model-value="jobId ? String(jobId) : undefined"
                :items="jobOptions"
                :placeholder="t('hrRecruitment.anyJob')"
                :disabled="!hydrated || jobs.isLoading.value"
                data-testid="hr-recruitment-job"
                @update:model-value="writeQuery({ job: $event ? Number($event) : null, stage: null, offset: 0 })"
              />
            </SharedFilterField>
            <SharedFilterField :label="t('hrRecruitment.columns.stage')" for="hr-recruitment-stage">
              <USelect
                id="hr-recruitment-stage"
                class="w-full"
                :model-value="stageId ? String(stageId) : undefined"
                :items="stageOptions"
                :placeholder="t('hrRecruitment.anyStage')"
                :disabled="!hydrated || stages.isLoading.value"
                data-testid="hr-recruitment-stage"
                @update:model-value="writeQuery({ stage: $event ? Number($event) : null, offset: 0 })"
              />
            </SharedFilterField>
            <template #active>
              <SharedFilterChip v-if="search.trim()" :label="t('hrRecruitment.searchValue', { value: search })" @remove="writeQuery({ q: '', offset: 0 })" />
              <SharedFilterChip v-if="status !== 'all'" :label="t(`hrRecruitment.statusFilter.${status}`)" @remove="writeQuery({ status: 'all', offset: 0 })" />
            </template>
          </SharedFilterBar>
        </div>
      </template>

      <SharedPageState :error="applicants.error.value" :keep-content="items.length > 0" @retry="applicants.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--webvue-card-pad-dense)" :title="t('hrRecruitment.emptyTitle')" :description="t('hrRecruitment.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="applicantTo"
          :loading="applicants.isLoading.value"
          :caption="t('hrRecruitment.title')"
        >
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-applicant-row-${row.original.id}`" /></template>
          <template #partner_name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.partner_name }}</span></template>
          <template #job-cell="{ row }">{{ row.original.job?.name || t('hrRecruitment.noJob') }}</template>
          <template #stage-cell="{ row }">{{ row.original.stage?.name || t('hrRecruitment.noStage') }}</template>
          <template #status-cell="{ row }">
            <SharedStatusBadge size="sm" :tone="hrApplicantBadge(row.original.status).tone" :label="t(hrApplicantBadge(row.original.status).labelKey)" data-testid="hr-applicant-status" />
          </template>
          <template #priority-cell="{ row }">
            <span class="tabular-nums text-muted">{{ t(hrApplicantPriorityKey(row.original.priority)) }}</span>
          </template>
          <template #mobile-row="{ row }">
            <div class="flex items-center justify-between gap-2">
              <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
              <SharedStatusBadge size="sm" :tone="hrApplicantBadge(row.status).tone" :label="t(hrApplicantBadge(row.status).labelKey)" />
            </div>
            <p class="mt-1 font-semibold text-highlighted">{{ row.partner_name }}</p>
            <p class="mt-1 text-sm">{{ row.job?.name || t('hrRecruitment.noJob') }} · {{ row.stage?.name || t('hrRecruitment.noStage') }}</p>
          </template>
        </SharedDataTable>
      </SharedPageState>
      <template v-if="applicants.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrRecruitment.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="applicants.isFetching.value"
          count-test-id="hr-recruitment-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
