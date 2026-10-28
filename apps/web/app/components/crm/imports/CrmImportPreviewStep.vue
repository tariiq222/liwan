<script setup lang="ts">
import type { CrmImportPreview } from '@webvue/contracts'
import { invalidReasonKey } from '@/utils/crmImport'

// Step 3: what the import would do, in counts, then the rows that would be refused (their number and why) and the rows
// that would be skipped as duplicates (their number only: a record that already exists is never described here).
const props = defineProps<{ preview: CrmImportPreview }>()
const { t } = useI18n()
const tiles = computed(() => [
  { id: 'new', label: t('crm.imports.flow.preview.new'), value: props.preview.new, tone: 'success' as const, icon: 'i-lucide-user-plus' as const },
  { id: 'duplicate', label: t('crm.imports.flow.preview.duplicate'), value: props.preview.duplicate, tone: 'neutral' as const, icon: 'i-lucide-copy' as const },
  { id: 'invalid', label: t('crm.imports.flow.preview.invalid'), value: props.preview.invalid, tone: props.preview.invalid ? 'danger' as const : 'neutral' as const, icon: 'i-lucide-circle-alert' as const },
])
const invalidHidden = computed(() => props.preview.invalid - props.preview.invalid_rows.length)
const duplicateHidden = computed(() => props.preview.duplicate - props.preview.duplicate_rows.length)
</script>

<template>
  <div class="grid gap-5" data-testid="crm-import-preview">
    <div class="grid grid-cols-3 gap-(--webvue-gap-card)">
      <SharedMetricTile v-for="tile in tiles" :key="tile.id" density="compact" :tone="tile.tone" :icon="tile.icon" :label="tile.label" :value="tile.value" value-dir="ltr" :data-testid="`crm-import-count-${tile.id}`" />
    </div>
    <p v-if="!preview.new" class="text-sm text-muted">{{ t('crm.imports.flow.preview.nothingNew') }}</p>
    <SharedRecordSection v-if="preview.invalid_rows.length" variant="panel" :title="t('crm.imports.flow.preview.invalidTitle')">
      <ul class="grid gap-2 text-sm" data-testid="crm-import-invalid-rows">
        <li v-for="item in preview.invalid_rows" :key="item.row">{{ t('crm.imports.flow.preview.invalidRow', { row: item.row, reason: t(invalidReasonKey(item.reason)) }) }}</li>
      </ul>
      <p v-if="invalidHidden > 0" class="mt-2 text-xs text-muted">{{ t('crm.imports.flow.preview.capped', { count: preview.invalid_rows.length }) }}</p>
    </SharedRecordSection>
    <SharedRecordSection v-if="preview.duplicate_rows.length" variant="panel" :title="t('crm.imports.flow.preview.duplicateTitle')">
      <p class="text-sm" data-testid="crm-import-duplicate-rows"><bdi>{{ t('crm.imports.flow.preview.duplicateRows', { rows: preview.duplicate_rows.join('، ') }) }}</bdi></p>
      <p v-if="duplicateHidden > 0" class="mt-2 text-xs text-muted">{{ t('crm.imports.flow.preview.capped', { count: preview.duplicate_rows.length }) }}</p>
    </SharedRecordSection>
  </div>
</template>
