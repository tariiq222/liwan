<script setup lang="ts">
import InboxFlowResponsesTable from '@/components/inbox/InboxFlowResponsesTable.vue'
import { useInboxFlow, useInboxFlowSubmissions } from '@/composables/inbox/useInboxFlows'

// The answers to one form: filtered by date and paged, all kept in the address (`?date_from=&date_to=&page=`), so a
// filtered view can be shared and survives refresh and back. The way back leads to the channel's forms for whoever
// manages them, otherwise to the inbox.
const PAGE_SIZE = 25
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const flowId = computed(() => {
  const value = Number(route.params.flowId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const isoDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
const dateFrom = computed(() => isoDate(route.query.date_from))
const dateTo = computed(() => isoDate(route.query.date_to))
const page = computed(() => {
  const value = Number(route.query.page)
  return Number.isSafeInteger(value) && value > 0 ? value : 1
})
const flow = useInboxFlow(flowId)
const submissions = useInboxFlowSubmissions(flowId, () => ({
  date_from: dateFrom.value ?? undefined, date_to: dateTo.value ?? undefined, limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE,
}))
const rows = computed(() => submissions.data.value?.items ?? [])
const pages = computed(() => Math.max(1, Math.ceil((submissions.data.value?.total ?? 0) / PAGE_SIZE)))
const backTo = computed(() => flow.data.value && can('inbox.flows.manage') ? `/settings/apps/inbox/channels/${flow.data.value.channel.id}/flows/${flow.data.value.id}` : '/inbox')
const backLabel = computed(() => backTo.value === '/inbox' ? t('inbox.title') : t('inbox.flows.responses.backToForm'))

function update(values: Record<string, string | undefined>) {
  if (!hydrated.value) return
  void router.replace({ path: route.path, query: { ...route.query, page: undefined, ...values } })
}
const setPage = (next: number) => update({ page: next > 1 ? String(next) : undefined })
const clear = () => update({ date_from: undefined, date_to: undefined })
</script>

<template>
  <SharedRecordPage
    :title="flow.data.value ? t('inbox.flows.responses.pageTitle', { name: flow.data.value.name }) : t('inbox.flows.responses.title')"
    :back-to="backTo"
    :back-label="backLabel"
    :loading="flowId !== null && flow.isPending.value"
    :error="flowId === null ? { status: 404 } : flow.error.value"
    @retry="hydrated && flow.refetch()"
  >
    <SharedFilterBar embedded class="w-full" :active-count="Number(!!dateFrom) + Number(!!dateTo)" :default-open="!!dateFrom || !!dateTo" :disabled="!hydrated" @clear="clear">
      <label class="flex items-center gap-2 text-sm">{{ t('inbox.flows.responses.from') }}<SharedDateField :model-value="dateFrom" :max-value="dateTo" :aria-label="t('inbox.flows.responses.from')" :disabled="!hydrated" @update:model-value="update({ date_from: $event ?? undefined })" /></label>
      <label class="flex items-center gap-2 text-sm">{{ t('inbox.flows.responses.to') }}<SharedDateField :model-value="dateTo" :min-value="dateFrom" :aria-label="t('inbox.flows.responses.to')" :disabled="!hydrated" @update:model-value="update({ date_to: $event ?? undefined })" /></label>
    </SharedFilterBar>
    <InboxFlowResponsesTable
      :flow="flow.data.value"
      :submissions="rows"
      :loading="submissions.isPending.value"
      :error="submissions.error.value"
      :page="page"
      :pages="pages"
      @update:page="setPage"
      @retry="submissions.refetch()"
    />
  </SharedRecordPage>
</template>
