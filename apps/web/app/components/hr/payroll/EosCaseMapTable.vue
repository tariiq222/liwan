<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { HR_EOS_CASES, HrEosCaseSchema, type HrEosCase, type HrEosCaseMap } from '@liwan/contracts'

// The end-of-service case each departure reason maps to. A choice is saved at once; only the row being saved waits.
// A reason with no case yet is shown as such and must be mapped (or given a case on the settlement) before a leaver
// with that reason can be settled. Without `canEdit` the table is read-only. A choice carries the revision of the row
// it changes; a choice the server refused as stale stays shown from `drafts` until the page reloads the mappings.
const props = defineProps<{
  mappings: HrEosCaseMap[]
  canEdit: boolean
  /** The departure reasons whose choice is being saved. */
  saving: number[]
  /** Unsaved choices by departure reason, shown instead of the stored case. */
  drafts: Partial<Record<number, HrEosCase>>
  /** A stale choice waits for a reload: every row is locked. */
  locked: boolean
}>()
const emit = defineEmits<{ change: [payload: { departureReasonId: number; case: HrEosCase; revision: number }] }>()

const { t } = useI18n()
const hydrated = useHydrated()

const columns = computed<TableColumn<HrEosCaseMap>[]>(() => [
  { id: 'reason', header: t('hrPayroll.eosCases.reason') },
  { id: 'case', header: t('hrPayroll.eosCases.case') },
])
const items = computed(() => HR_EOS_CASES.map(value => ({ value, label: t(`hrPayroll.eos.cases.${value}`) })))
const caseLabel = (mapping: HrEosCaseMap) => mapping.case ? t(`hrPayroll.eos.cases.${mapping.case}`) : t('hrPayroll.eosCases.unmapped')
const shown = (mapping: HrEosCaseMap) => props.drafts[mapping.departure_reason.id] ?? mapping.case ?? undefined
const rowLocked = (mapping: HrEosCaseMap) => !hydrated.value || props.locked || props.saving.includes(mapping.departure_reason.id)
const select = (mapping: HrEosCaseMap, value: unknown) => {
  const parsed = HrEosCaseSchema.safeParse(value)
  if (parsed.success) emit('change', { departureReasonId: mapping.departure_reason.id, case: parsed.data, revision: mapping.revision })
}
</script>

<template>
  <SharedDataTable
    :rows="props.mappings"
    :columns="columns"
    :row-key="(row: HrEosCaseMap) => row.departure_reason.id"
    :empty-text="t('hrPayroll.eosCases.empty')"
    :caption="t('hrPayroll.eosCases.title')"
  >
    <template #reason-cell="{ row }">{{ row.original.departure_reason.name }}</template>
    <template #case-cell="{ row }">
      <USelect
        v-if="props.canEdit"
        class="w-full min-w-48"
        :model-value="shown(row.original)"
        :items="items"
        :placeholder="t('hrPayroll.eosCases.unmapped')"
        :disabled="rowLocked(row.original)"
        :aria-label="t('hrPayroll.eosCases.case')"
        :data-testid="`hr-eos-case-${row.original.departure_reason.id}`"
        @update:model-value="select(row.original, $event)"
      />
      <span v-else>{{ caseLabel(row.original) }}</span>
    </template>
    <template #mobile-row="{ row }">
      <p class="font-semibold text-highlighted">{{ row.departure_reason.name }}</p>
      <USelect
        v-if="props.canEdit"
        class="mt-2 w-full"
        :model-value="shown(row)"
        :items="items"
        :placeholder="t('hrPayroll.eosCases.unmapped')"
        :disabled="rowLocked(row)"
        :aria-label="t('hrPayroll.eosCases.case')"
        @update:model-value="select(row, $event)"
      />
      <p v-else class="text-sm text-muted">{{ caseLabel(row) }}</p>
    </template>
  </SharedDataTable>
</template>
