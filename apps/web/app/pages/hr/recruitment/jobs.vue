<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import RecordNumber from '@liwan/ui/app/components/shared/data/RecordNumber.vue'
import { recordNumberHeader } from '@liwan/ui/app/utils/recordNumberHeader'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import {
  HR_RECRUITMENT_PAGE_SIZE,
  type HrRecruitmentActiveFilter,
  type HrRecruitmentJob,
} from '@/composables/useHrRecruitment'

const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()

const LIMIT = HR_RECRUITMENT_PAGE_SIZE
// The jobs list is this page's own screen and stays behind its create panel; the job record
// is a full page of its own, so the list is not drawn under it.
const isJobsRoute = computed(() => {
  const path = route.path.replace(/\/+$/, '') || '/'
  return path === '/hr/recruitment/jobs' || path === '/hr/recruitment/jobs/new'
})
const canManage = computed(() => can('hr.recruitment.manage'))
const ACTIVE_FILTERS: HrRecruitmentActiveFilter[] = ['true', 'false', 'all']

function activeParam(value: unknown): HrRecruitmentActiveFilter {
  const raw = Array.isArray(value) ? value[0] : value
  return ACTIVE_FILTERS.find(candidate => candidate === raw) ?? 'true'
}

const search = computed(() => (typeof route.query.q === 'string' ? route.query.q : ''))
const active = computed(() => activeParam(route.query.active))
const offset = computed(() => Math.max(0, Number(route.query.offset ?? 0) || 0))

const jobs = useHrRecruitmentJobList(computed(() => ({
  q: search.value,
  active: active.value,
  limit: LIMIT,
  offset: offset.value,
})))

const items = computed(() => jobs.data.value?.items ?? [])
const total = computed(() => jobs.data.value?.total ?? 0)
const page = computed(() => Math.floor(offset.value / LIMIT) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / LIMIT)))
const showEmpty = computed(() => !jobs.isLoading.value && !jobs.error.value && items.value.length === 0)
const activeFilterCount = computed(() => [search.value.trim(), active.value === 'true' ? null : active.value].filter(Boolean).length)

const activeOptions = computed(() => ACTIVE_FILTERS.map(value => ({
  value,
  label: t(`hrRecruitment.jobs.filter.${value}`),
  testId: `hr-recruitment-jobs-${value}`,
})))

const columns = computed<TableColumn<HrRecruitmentJob>[]>(() => [
  { accessorKey: 'id', header: () => recordNumberHeader(t), meta: { class: { th: 'w-[48px] min-w-[48px] px-2', td: 'w-[48px] min-w-[48px] px-2' } } },
  { accessorKey: 'name', header: t('hrRecruitment.jobs.columns.name') },
  { accessorKey: 'department', header: t('hrRecruitment.jobs.columns.department') },
  { accessorKey: 'no_of_recruitment', header: t('hrRecruitment.jobs.columns.target'), meta: { class: { th: 'w-[96px]', td: 'w-[96px]' } } },
  { accessorKey: 'application_count', header: t('hrRecruitment.jobs.columns.applications'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
  { accessorKey: 'active', header: t('hrRecruitment.jobs.columns.state'), meta: { class: { th: 'w-[110px]', td: 'w-[110px]' } } },
])

function writeQuery(patch: Partial<{ q: string; active: HrRecruitmentActiveFilter; offset: number }>) {
  if (!hydrated.value) return
  const nextActive = patch.active ?? active.value
  void router.replace({
    query: {
      ...route.query,
      q: (patch.q ?? search.value).trim() || undefined,
      active: nextActive === 'true' ? undefined : nextActive,
      offset: (patch.offset ?? 0) > 0 ? patch.offset : undefined,
    },
    hash: route.hash,
  })
}
function setPage(next: number) {
  if (!hydrated.value || jobs.isFetching.value || next < 1 || next > pages.value) return
  writeQuery({ offset: (next - 1) * LIMIT })
}

// The applicant list is the owning list this sibling list returns to; its filters are not ours.
const backTo = computed(() => ({ path: '/hr/recruitment' }))
const listQuery = computed(() => {
  const { returnTo: _referrer, ...context } = route.query
  return context
})
const createTo = computed(() => canManage.value ? { path: '/hr/recruitment/jobs/new', query: listQuery.value } : undefined)
function jobTo(job: HrRecruitmentJob) {
  return { path: `/hr/recruitment/jobs/${job.id}`, query: returnToQuery(route.fullPath) }
}
</script>

<template>
  <SharedListPage
    v-if="isJobsRoute"
    :title="t('hrRecruitment.jobs.title')"
    :back-to="backTo"
    :back-label="t('hrRecruitment.title')"
    :create-to="createTo"
    :create-label="t('hrRecruitment.jobs.new')"
    create-test-id="hr-recruitment-job-new"
  >
    <SharedListCard>
      <template #filters>
        <div class="liwan-page-stack">
          <SharedSegmentedControl
            :model-value="active"
            :items="activeOptions"
            :label="t('hrRecruitment.jobs.columns.state')"
            :disabled="!hydrated"
            @update:model-value="writeQuery({ active: activeParam($event), offset: 0 })"
          />
          <SharedFilterBar embedded class="w-full" :active-count="activeFilterCount" :disabled="!hydrated" @clear="writeQuery({ q: '', active: 'true', offset: 0 })">
            <template #search>
              <UInput
                :model-value="search"
                class="min-w-48 flex-1"
                icon="i-lucide-search"
                :disabled="!hydrated"
                :aria-label="t('hrRecruitment.jobs.search')"
                :placeholder="t('hrRecruitment.jobs.search')"
                data-testid="hr-recruitment-jobs-search"
                @update:model-value="writeQuery({ q: String($event ?? ''), offset: 0 })"
              />
            </template>
            <template #active>
              <SharedFilterChip v-if="search.trim()" :label="t('hrRecruitment.searchValue', { value: search })" @remove="writeQuery({ q: '', offset: 0 })" />
              <SharedFilterChip v-if="active !== 'true'" :label="t(`hrRecruitment.jobs.filter.${active}`)" @remove="writeQuery({ active: 'true', offset: 0 })" />
            </template>
          </SharedFilterBar>
        </div>
      </template>

      <SharedPageState :error="jobs.error.value" :keep-content="items.length > 0" @retry="jobs.refetch">
        <SharedEmptyState v-if="showEmpty" class="m-(--liwan-card-pad-dense)" :title="t('hrRecruitment.jobs.emptyTitle')" :description="t('hrRecruitment.jobs.emptyHint')" />
        <SharedDataTable
          v-else
          bare
          :rows="items"
          :columns="columns"
          row-key="id"
          :row-to="jobTo"
          :loading="jobs.isLoading.value"
          :caption="t('hrRecruitment.jobs.title')"
        >
          <template #id-cell="{ row }"><RecordNumber :value="row.original.id" :data-testid="`hr-recruitment-job-row-${row.original.id}`" /></template>
          <template #name-cell="{ row }"><span class="font-semibold text-highlighted">{{ row.original.name }}</span></template>
          <template #department-cell="{ row }">{{ row.original.department?.name || t('hrRecruitment.noDepartment') }}</template>
          <template #no_of_recruitment-cell="{ row }"><span class="tabular-nums">{{ row.original.no_of_recruitment }}</span></template>
          <template #application_count-cell="{ row }"><span class="tabular-nums">{{ row.original.application_count }}</span></template>
          <template #active-cell="{ row }">
            <SharedStatusBadge size="sm" :tone="row.original.active ? 'success' : 'neutral'" :label="row.original.active ? t('hrRecruitment.jobs.state.active') : t('hrRecruitment.jobs.state.archived')" />
          </template>
          <template #mobile-row="{ row }">
            <div class="flex items-center justify-between gap-2">
              <bdi class="text-xs text-muted">#{{ row.id }}</bdi>
              <SharedStatusBadge size="sm" :tone="row.active ? 'success' : 'neutral'" :label="row.active ? t('hrRecruitment.jobs.state.active') : t('hrRecruitment.jobs.state.archived')" />
            </div>
            <p class="mt-1 font-semibold text-highlighted">{{ row.name }}</p>
            <p class="mt-1 text-sm">{{ row.department?.name || t('hrRecruitment.noDepartment') }} · <span class="tabular-nums">{{ row.application_count }}</span></p>
          </template>
        </SharedDataTable>
      </SharedPageState>
      <template v-if="jobs.data.value && !showEmpty" #footer>
        <SharedListFooter
          :count-label="t('hrRecruitment.jobs.footer', { shown: items.length, total }, total)"
          :page="page"
          :pages="pages"
          :disabled="jobs.isFetching.value"
          count-test-id="hr-recruitment-jobs-count"
          @update:page="setPage"
        />
      </template>
    </SharedListCard>
  </SharedListPage>
  <NuxtPage />
</template>
