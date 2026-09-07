<script setup lang="ts">
import type { ProjectReportStatusFilter } from '@/utils/projectFinance'
import { REPORT_PAGE, nextOffsetAfterListResult } from '@/utils/projectFinance'
import ReportTable from '@/components/project/finance/ReportTable.vue'
import ReportTotals from '@/components/project/finance/ReportTotals.vue'
import { useProjectReports } from '@/composables/useProjectReports'

const props = defineProps<{
  q: string
  status: ProjectReportStatusFilter
  offset: number
}>()

const emit = defineEmits<{
  'update:offset': [offset: number]
}>()

const hydrated = useHydrated()
const { t } = useI18n()
const listFilters = computed(() => ({
  q: props.q.trim() || undefined,
  status: props.status,
  limit: REPORT_PAGE,
  offset: props.offset,
}))
const reports = useProjectReports(listFilters)
const items = computed(() => reports.data.value?.items ?? [])
const totals = computed(() => reports.data.value?.totals ?? [])
const total = computed(() => reports.data.value?.total ?? 0)
const page = computed(() => Math.floor(props.offset / REPORT_PAGE) + 1)
const pages = computed(() => Math.max(1, Math.ceil(total.value / REPORT_PAGE)))
const filtered = computed(() => Boolean(props.q.trim()) || props.status !== 'all')

function setPage(next: number) {
  if (!hydrated.value || reports.isFetching.value || next < 1 || next > pages.value) return
  emit('update:offset', (next - 1) * REPORT_PAGE)
}

watch(
  () => ({
    fetching: reports.isFetching.value,
    requestedOffset: props.offset,
    responseOffset: listFilters.value.offset,
    total: reports.data.value?.total,
  }),
  ({ fetching, requestedOffset, responseOffset, total }) => {
    const next = nextOffsetAfterListResult({
      isFetching: fetching,
      requestedOffset,
      responseOffset,
      total,
      pageSize: REPORT_PAGE,
    })
    if (next !== null && next !== props.offset) emit('update:offset', next)
  },
)
</script>

<template>
  <section data-testid="reports-page" class="space-y-5">
    <SharedPageState :loading="reports.isLoading.value && !reports.data.value" :error="reports.error.value" @retry="reports.refetch">
      <ReportTotals :totals="totals" />
      <ReportTable :items="items" :is-loading="reports.isLoading.value" :filtered="filtered" />
      <div v-if="pages > 1" class="flex items-center justify-between text-sm text-muted-foreground">
        <Button variant="ghost" :disabled="!hydrated || page === 1 || reports.isFetching.value" @click="setPage(page - 1)">
          {{ t('projects.previousPage') }}
        </Button>
        <span>{{ t('projects.pageOf', { page, pages }) }}</span>
        <Button variant="ghost" :disabled="!hydrated || page >= pages || reports.isFetching.value" @click="setPage(page + 1)">
          {{ t('projects.nextPage') }}
        </Button>
      </div>
    </SharedPageState>
  </section>
</template>
