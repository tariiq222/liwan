<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { AuditEvent, AuditList } from '@webvue/commercial-contracts'
import { formatDateTime } from '@webvue/ui/app/utils/formatDate'
import { AUDIT_CATEGORIES, AUDIT_PAGE_SIZE, auditActionParts, auditActor, auditFilterCount, auditFilters, auditListQuery } from '@/utils/vendorAudit'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
definePageMeta({ capability: 'vendor.audit.read' })
const { t } = useI18n(); const route = useRoute(); const router = useRouter(); const hydrated = useHydrated(); const { request } = useVendorApi()
const api = useVendorSubscriptions()
const filters = computed(() => auditFilters(route.query))
const filterKey = computed(() => JSON.stringify(filters.value))
const customerId = computed(() => filters.value.customer_id)
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / AUDIT_PAGE_SIZE)))
function patch(change: Record<string, unknown>) { void router.replace({ path: '/audit', query: { ...route.query, page: undefined, ...change } }) }
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:audit:${filterKey.value}:${page.value}`, () => request<AuditList>('audit', { query: auditListQuery(filters.value, page.value) }), { watch: [filterKey, page] })
// The chip names the customer whose log is shown; `api.customer` answers null only for an unknown customer (404), any other failure surfaces as the page error.
const { data: customer, error: customerError } = await useAsyncData(() => `vendor:audit:customer:${customerId.value ?? ''}`, async () => (customerId.value ? await api.customer(customerId.value) : null), { watch: [customerId] })
// The text inputs keep what is typed; the URL (the source of truth) follows after a pause so each keystroke does not refetch.
const search = ref(filters.value.q ?? ''), actor = ref(filters.value.actor ?? '')
watch(() => filters.value.q, value => { search.value = value ?? '' })
watch(() => filters.value.actor, value => { actor.value = value ?? '' })
const patchText = useDebounceFn(() => patch({ q: search.value || undefined, actor: actor.value || undefined }), 300)
const items = computed(() => data.value?.items ?? [])
const filtered = computed(() => auditFilterCount(filters.value) > 0)
const categoryItems = computed(() => {
  const current = filters.value.action
  const known = (AUDIT_CATEGORIES as readonly string[]).includes(current ?? '') || !current ? [] : [{ value: current, label: actionLabel(current) }]
  return [{ value: 'all', label: t('vendor.audit.allCategories') }, ...known, ...AUDIT_CATEGORIES.map(value => ({ value, label: t(`vendor.audit.categories.${value}`) }))]
})
function actionLabel(action: string): string {
  const operation = auditActionParts(action)
  if (operation) return `${t(`vendor.operations.types.${operation.type}`)} · ${t(`vendor.status.${operation.status}`)}`
  if ((AUDIT_CATEGORIES as readonly string[]).includes(action)) return t(`vendor.audit.categories.${action}`)
  return t(`vendor.audit.actions.${action}`, action)
}
function actorLabel(event: AuditEvent): string {
  const actor = auditActor(event)
  if (actor.kind === 'name') return actor.name
  if (actor.kind === 'system') return t(`vendor.audit.actors.${actor.key}`)
  return actor.kind === 'legacy' ? `${t('vendor.audit.actors.legacy')} ${actor.id}` : actor.id
}
const customerLabel = computed(() => (customer.value?.name ? t('vendor.audit.customerFilter', { name: customer.value.name }) : t('vendor.audit.customerFilterUnknown')))

const columns = computed<TableColumn<AuditEvent>[]>(() => [
  { id: 'when', header: t('vendor.audit.when') },
  { id: 'action', header: t('vendor.audit.action') },
  { id: 'actor', header: t('vendor.audit.actor') },
  { id: 'subject', header: t('vendor.audit.subject') },
  { id: 'reason', header: t('vendor.tenants.fields.reason') },
])
</script>
<template>
<SharedListPage :title="t('vendor.audit.title')" :description="t('vendor.audit.description')">

<template #filters><SharedFilterBar :active-count="auditFilterCount(filters)" @clear="router.replace('/audit')">
      <template #search><UInput v-model="search" :aria-label="t('vendor.audit.search')" :placeholder="t('vendor.audit.search')" icon="i-lucide-search" :disabled="!hydrated" @update:model-value="patchText()" /></template>
      <SharedFilterField :label="t('vendor.audit.category')" for="audit-category"><USelect id="audit-category" :model-value="filters.action ?? 'all'" :items="categoryItems" class="w-full" :disabled="!hydrated" @update:model-value="patch({ action: $event && $event !== 'all' ? $event : undefined })" /></SharedFilterField>
      <SharedFilterField :label="t('vendor.audit.actorFilter')" for="audit-actor"><UInput id="audit-actor" v-model="actor" :placeholder="t('vendor.audit.actorPlaceholder')" class="w-full" :disabled="!hydrated" @update:model-value="patchText()" /></SharedFilterField>
      <SharedFilterField :label="t('vendor.audit.from')" for="audit-from"><UInput id="audit-from" type="date" :model-value="filters.from ?? ''" class="w-full" :disabled="!hydrated" @update:model-value="patch({ from: $event || undefined })" /></SharedFilterField>
      <SharedFilterField :label="t('vendor.audit.to')" for="audit-to"><UInput id="audit-to" type="date" :model-value="filters.to ?? ''" class="w-full" :disabled="!hydrated" @update:model-value="patch({ to: $event || undefined })" /></SharedFilterField>
      <template #active>
        <SharedFilterChip v-if="filters.q" :label="filters.q" @remove="patch({ q: undefined })" />
        <SharedFilterChip v-if="filters.action" :label="actionLabel(filters.action)" @remove="patch({ action: undefined })" />
        <SharedFilterChip v-if="filters.actor" :label="`${t('vendor.audit.actor')}: ${filters.actor}`" @remove="patch({ actor: undefined })" />
        <SharedFilterChip v-if="filters.customer_id" :label="customerLabel" @remove="patch({ customer_id: undefined })" />
        <SharedFilterChip v-if="filters.from" :label="`${t('vendor.audit.from')}: ${filters.from}`" @remove="patch({ from: undefined })" />
        <SharedFilterChip v-if="filters.to" :label="`${t('vendor.audit.to')}: ${filters.to}`" @remove="patch({ to: undefined })" />
      </template>
    </SharedFilterBar></template>

<p v-if="data" class="text-sm text-muted" data-testid="audit-result-count">{{ t('vendor.pagination.total', { count: data.total }, data.total) }}</p>

<SharedDataTable :rows="items" :columns="columns" row-key="id" :loading="pending" :error="error || customerError" :empty-text="t(filtered ? 'vendor.audit.noResults' : 'vendor.audit.empty')" :caption="t('vendor.audit.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => patch({ page: value })">
  <template #when-cell="{ row: { original: entry } }"><time :datetime="entry.created_at">{{ formatDateTime(entry.created_at) }}</time></template>
  <template #action-cell="{ row: { original: entry } }">{{ actionLabel(entry.action) }}</template>
  <template #actor-cell="{ row: { original: entry } }"><bdi>{{ actorLabel(entry) }}</bdi></template>
  <template #subject-cell="{ row: { original: entry } }"><VendorAuditSubject :event="entry" /></template>
  <template #reason-cell="{ row: { original: entry } }">{{ entry.reason }}</template>
  <template #mobile-row="{ row: entry }"><div class="flex flex-wrap justify-between gap-2"><h2 class="font-medium">{{ actionLabel(entry.action) }}</h2><time class="text-sm text-muted" :datetime="entry.created_at">{{ formatDateTime(entry.created_at) }}</time></div>
          <p class="mt-2 text-sm">{{ entry.reason }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('vendor.audit.actor') }}: <bdi>{{ actorLabel(entry) }}</bdi></p>
          <p class="mt-1 text-xs">{{ t('vendor.audit.subject') }}: <VendorAuditSubject :event="entry" /></p></template>
</SharedDataTable>
</SharedListPage>
</template>
