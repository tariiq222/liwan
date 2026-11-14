<script setup lang="ts">
import { SALES_LIMITS, type SalesSettings } from '@liwan/contracts'
import { useSalesSettingsCard } from '@/composables/sales/useSalesSettingsCard'

// What a new quotation starts with and how far a discount goes without approval: the validity in days and the default
// terms apply to new quotations only; the discount limit to new and edited lines (0 means no limit).
const props = defineProps<{ settings: SalesSettings; canEdit: boolean; reloadSettings: () => Promise<SalesSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { draft, state, save, revert, reload } = useSalesSettingsCard(['validity_days', 'discount_limit_percent', 'default_terms'] as const, { settings: () => props.settings, reload: () => props.reloadSettings() })
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
</script>

<template>
  <SharedSettingsCard id="quotations" v-bind="state" :title="t('sales.settings.quotations.title')" :description="t('sales.settings.quotations.hint')" :can-edit="canEdit" @save="save" @revert="revert" @reload="reload">
    <div class="liwan-auto-grid [--liwan-auto-grid-min:14rem]">
      <UFormField :label="t('sales.settings.quotations.validityDays')" :help="t('sales.settings.quotations.validityDaysHint')">
        <UInputNumber v-model="draft.validity_days" class="w-full" :min="0" :max="SALES_LIMITS.validityDays" :step="1" :disabled="locked" data-testid="sales-validity-days" />
      </UFormField>
      <UFormField :label="t('sales.settings.quotations.discountLimit')" :help="t('sales.settings.quotations.discountLimitHint')">
        <UInputNumber v-model="draft.discount_limit_percent" class="w-full" :min="0" :max="100" :step="1" :disabled="locked" data-testid="sales-discount-limit" />
      </UFormField>
    </div>
    <UFormField :label="t('sales.settings.quotations.defaultTerms')" :help="t('sales.settings.quotations.defaultTermsHint')">
      <UTextarea v-model="draft.default_terms" class="w-full" :rows="4" autoresize :maxlength="SALES_LIMITS.terms" :disabled="locked" data-testid="sales-default-terms" />
    </UFormField>
  </SharedSettingsCard>
</template>
