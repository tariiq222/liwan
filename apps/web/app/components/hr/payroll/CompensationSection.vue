<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrCompensation } from '@webvue/contracts'
import { formatDate } from '@webvue/ui/app/utils/formatDate'
import { formatPayrollAmount, payrollCurrencyLabel } from '@/utils/payrollFormat'

// The compensation block of the employee record: wage, allowances, bank account and GOSI facts.
// A null record means nothing is recorded yet. The page owns the query and decides who sees this.
const props = defineProps<{
  compensation: HrCompensation | null
  canManage: boolean
  editTo: RouteLocationRaw
}>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const money = (value: number) => `${formatPayrollAmount(value, locale.value)} ${payrollCurrencyLabel(props.compensation?.currency ?? 'SAR', t('hrPayroll.currency'))}`
const relationshipItems = usePayrollRelationshipItems()
const relationshipLabel = (value: string) => relationshipItems.value.find(item => item.value === value)?.label
const editLabel = computed(() => t(props.compensation ? 'hrPayroll.compensation.edit' : 'hrPayroll.compensation.add'))
</script>

<template>
  <SharedRecordSection :title="t('hrPayroll.compensation.title')">
    <template v-if="canManage" #actions>
      <UButton color="neutral" variant="outline" size="sm" icon="i-lucide-pencil" :disabled="!hydrated" :to="editTo" :label="editLabel" data-testid="hr-compensation-edit" @click="!hydrated && $event.preventDefault()" />
    </template>
    <SharedEmptyState v-if="!compensation" compact :title="t('hrPayroll.compensation.empty')" :description="t('hrPayroll.compensation.emptyHint')" />
    <SharedPropertiesPanel v-else>
      <SharedPropertyRow :label="t('hrPayroll.compensation.relationship')" :value="relationshipLabel(compensation.relationship_type)" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.basicWage')" :value="money(compensation.basic_wage)" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.housingAllowance')" :value="money(compensation.housing_allowance)" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.transportAllowance')" :value="money(compensation.transport_allowance)" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.otherAllowance')" :value="money(compensation.other_allowance)" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.fixedWage')" :value="money(compensation.fixed_wage)" />
      <SharedPropertyRow v-if="compensation.iban" :label="t('hrPayroll.compensation.iban')"><bdi dir="ltr">{{ compensation.iban }}</bdi></SharedPropertyRow>
      <SharedPropertyRow v-else :label="t('hrPayroll.compensation.iban')" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.bank')" :value="compensation.bank?.name" />
      <SharedPropertyRow v-if="compensation.gosi_number" :label="t('hrPayroll.compensation.gosiNumber')"><bdi dir="ltr">{{ compensation.gosi_number }}</bdi></SharedPropertyRow>
      <SharedPropertyRow v-else :label="t('hrPayroll.compensation.gosiNumber')" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.gosiRegistrationDate')" :value="compensation.gosi_registration_date ? formatDate(compensation.gosi_registration_date) : null" />
      <SharedPropertyRow :label="t('hrPayroll.compensation.nationality')" :value="compensation.nationality?.name" />
    </SharedPropertiesPanel>
    <HrPayrollRelationshipWarning v-if="compensation" :relationship="compensation.relationship_type" />
  </SharedRecordSection>
</template>
