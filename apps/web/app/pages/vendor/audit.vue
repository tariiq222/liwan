<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.audit.read' })
type Audit = { id: string; actor: string; action: string; subject: string; reason: string; created_at: string }
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi()
const router = useRouter()
const { data, error, pending, refresh } = await useAsyncData(() => `vendor:audit:${route.query.page ?? '1'}`, () => request<{ items: Audit[]; total: number }>('audit', { query: { page: route.query.page } }))
const page = computed(() => Math.max(1, Number(route.query.page ?? 1) || 1))
const pages = computed(() => Math.max(1, Math.ceil((data.value?.total ?? 0) / 25)))
function actionLabel(action: string): string {
  const operation = /^operation\.(tenant\.(?:create|inspect|entitle)|health|backup|upgrade|restore)\.(queued|succeeded|failed|needs_intervention)$/.exec(action)
  return operation
    ? `${t(`vendor.operations.types.${operation[1]}`)} · ${t(`vendor.status.${operation[2]}`)}`
    : t(`vendor.audit.actions.${action}`, action)
}

const items = computed(() => data.value?.items ?? [])

const columns = computed<TableColumn<(typeof items.value)[number]>[]>(() => [
  { id: 'when', header: t('vendor.operations.updated') },
  { id: 'action', header: t('vendor.audit.title') },
  { id: 'actor', header: t('vendor.audit.actor') },
  { id: 'subject', header: t('vendor.audit.subject') },
  { id: 'reason', header: t('vendor.tenants.fields.reason') },
])
</script>
<template>
<SharedListPage :title="t('vendor.audit.title')" :description="t('vendor.audit.description')">

<p v-if="data" class="text-sm text-muted" data-testid="audit.vue-result-count">{{ t('vendor.pagination.total', { count: data.total }) }}</p>

<SharedDataTable  :rows="items" :columns="columns" row-key="id" :loading="pending" :error="error" :empty-text="t('vendor.audit.empty')" :caption="t('vendor.audit.title')" @retry="refresh" :page="page" :pages="pages" @update:page="value => router.replace({ query: { ...route.query, page: value } })">
  <template #when-cell="{ row: { original: entry } }"><time :datetime="entry.created_at">{{ new Date(entry.created_at).toLocaleString() }}</time></template>
  <template #action-cell="{ row: { original: entry } }">{{ actionLabel(entry.action) }}</template>
  <template #actor-cell="{ row: { original: entry } }">{{ entry.actor }}</template>
  <template #subject-cell="{ row: { original: entry } }">{{ entry.subject }}</template>
  <template #reason-cell="{ row: { original: entry } }">{{ entry.reason }}</template>
  <template #mobile-row="{ row: entry }"><div class="flex flex-wrap justify-between gap-2"><h2 class="font-medium">{{ actionLabel(entry.action) }}</h2><time class="text-sm text-muted" :datetime="entry.created_at">{{ new Date(entry.created_at).toLocaleString() }}</time></div>
          <p class="mt-2 text-sm">{{ entry.reason }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('vendor.audit.actor') }}: {{ entry.actor }} · {{ t('vendor.audit.subject') }}: {{ entry.subject }}</p></template>
</SharedDataTable>
</SharedListPage>
</template>
