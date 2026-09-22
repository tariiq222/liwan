<script setup lang="ts">
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
type Catalog = {
  id: string
  version: string
  status: 'draft' | 'validated' | 'published'
  solution: Record<string, unknown>
  created_at: string
}

const { t } = useI18n()
const { request } = useVendorApi()
const { can } = useVendorContext()
const { data, error, pending, refresh } = await useAsyncData('vendor:catalog', () => request<{ items: Catalog[]; total: number }>('catalog'))
const busy = ref('')
const failure = ref<unknown>(null)
const reason = ref('')

async function transition(item: Catalog, action: 'validate' | 'publish') {
  if (busy.value || !can('vendor.catalog.manage') || !reason.value.trim()) return
  busy.value = `${item.id}:${action}`
  failure.value = null
  try {
    await request(`catalog/${encodeURIComponent(item.id)}/${action}`, { method: 'POST', body: { reason: reason.value } })
    reason.value = ''
    await refresh()
  } catch (cause) {
    failure.value = cause
  } finally {
    busy.value = ''
  }
}
</script>

<template>
  <SharedPageContainer width="list">
    <SharedPageHeader :title="t('vendor.catalog.title')" :description="t('vendor.catalog.description')" />
    <SharedPageState :loading="pending" :error="error" :empty="!pending && !error && !data?.items.length" :empty-text="t('vendor.catalog.empty')" @retry="refresh">
      <UAlert v-if="failure" class="mb-4" color="error" variant="subtle" :title="t('vendor.errors.action')" />
      <UAlert v-if="can('vendor.catalog.manage')" class="mb-4" color="neutral" variant="subtle" :title="t('vendor.catalog.reasonNotice')" />
      <UFormField v-if="can('vendor.catalog.manage')" class="mb-4 max-w-xl" :label="t('vendor.tenants.fields.reason')" required>
        <UTextarea v-model="reason" maxlength="1000" class="w-full" />
      </UFormField>
      <div class="grid gap-4">
        <UCard v-for="item in data?.items ?? []" :key="item.id">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 class="font-semibold">{{ item.version }}</h2>
              <p class="text-sm text-muted">{{ item.id }} · {{ new Date(item.created_at).toLocaleString() }}</p>
              <UBadge class="mt-2" color="neutral" variant="subtle">{{ t(`vendor.catalog.status.${item.status}`) }}</UBadge>
            </div>
            <div v-if="can('vendor.catalog.manage')" class="flex gap-2">
              <UButton v-if="item.status === 'draft'" :loading="busy === `${item.id}:validate`" :disabled="Boolean(busy) || !reason.trim()" color="neutral" variant="outline" @click="transition(item, 'validate')">{{ t('vendor.catalog.validate') }}</UButton>
              <UButton v-if="item.status === 'validated'" :loading="busy === `${item.id}:publish`" :disabled="Boolean(busy) || !reason.trim()" @click="transition(item, 'publish')">{{ t('vendor.catalog.publish') }}</UButton>
            </div>
          </div>
          <details class="mt-4">
            <summary class="cursor-pointer text-sm">{{ t('vendor.catalog.solution') }}</summary>
            <pre class="mt-2 max-h-96 overflow-auto rounded-md bg-elevated p-3 text-xs">{{ JSON.stringify(item.solution, null, 2) }}</pre>
          </details>
        </UCard>
      </div>
    </SharedPageState>
  </SharedPageContainer>
</template>
