<script setup lang="ts">
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
</script>
<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.audit.title')" :description="t('vendor.audit.description')" />
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !data?.items.length" :empty-text="t('vendor.audit.empty')" @retry="refresh">
      <ol class="grid gap-3">
        <li v-for="entry in data?.items ?? []" :key="entry.id" class="rounded-lg bg-default p-4 ring ring-default">
          <div class="flex flex-wrap justify-between gap-2"><h2 class="font-medium">{{ actionLabel(entry.action) }}</h2><time class="text-sm text-muted" :datetime="entry.created_at">{{ new Date(entry.created_at).toLocaleString() }}</time></div>
          <p class="mt-2 text-sm">{{ entry.reason }}</p>
          <p class="mt-1 text-xs text-muted">{{ t('vendor.audit.actor') }}: {{ entry.actor }} · {{ t('vendor.audit.subject') }}: {{ entry.subject }}</p>
        </li>
      </ol>
      <div v-if="data" class="mt-4 grid gap-3"><p class="text-sm text-muted">{{ t('vendor.pagination.total', { count: data.total }) }}</p><SharedPagination :page="page" :pages="pages" @update:page="value => router.replace({ query: { ...route.query, page: value } })" /></div>
    </SharedPageState>
  </SharedPageContainer>
</template>
