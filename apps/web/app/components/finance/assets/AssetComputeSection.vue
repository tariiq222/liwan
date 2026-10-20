<script setup lang="ts">
import { entryRecordPath } from '../accounting/entryPaths'
import type { AssetComputeState } from './useAssetCompute'

// The depreciation posting above the assets list: the confirmation with its date while open, then what the server posted.
defineProps<{ compute: AssetComputeState }>()
const { t } = useI18n()
</script>

<template>
  <SharedInlineConfirm
    v-if="compute.open"
    color="primary"
    :title="t('financeAssets.compute.title')"
    :description="t('financeAssets.compute.hint')"
    :confirm-label="t('financeAssets.compute.confirm')"
    :pending="compute.pending"
    :disabled="!compute.hydrated || !compute.date"
    data-testid="finance-asset-compute-confirm"
    @confirm="compute.run()"
    @cancel="compute.cancel()"
  >
    <UFormField class="mt-3 max-w-xs" :label="t('financeAssets.compute.date')" name="finance-asset-compute-date" :error="compute.date ? undefined : t('financeAssets.compute.dateRequired')">
      <SharedDateField id="finance-asset-compute-date" v-model="compute.date" :max-value="compute.today" :disabled="!compute.hydrated || compute.pending" />
    </UFormField>
    <UAlert v-if="compute.error" class="mt-3" role="alert" color="error" variant="subtle" :title="compute.error" data-testid="finance-asset-compute-error" />
  </SharedInlineConfirm>
  <UAlert v-else-if="compute.result" role="status" color="success" variant="subtle" :title="compute.result.entries.length ? t('financeAssets.compute.done', { count: compute.result.entries.length, date: compute.result.date }, compute.result.entries.length) : t('financeAssets.compute.nothingDue')" data-testid="finance-asset-compute-result">
    <template v-if="compute.result.entries.length" #description>
      <ul class="flex flex-wrap gap-x-4 gap-y-1">
        <li v-for="entry in compute.result.entries" :key="entry.id">
          <NuxtLink :to="entryRecordPath(entry.id)" class="font-medium underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><bdi>{{ entry.name }}</bdi></NuxtLink>
        </li>
      </ul>
    </template>
  </UAlert>
</template>
