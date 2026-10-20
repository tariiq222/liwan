<script setup lang="ts">
import { useFinanceFiscalYears } from '@/composables/finance/useFinanceClosing'
import { useFinanceSetup } from '@/composables/finance/useFinanceSetup'
import ClosingPreview from './ClosingPreview.vue'
import ClosingYears from './ClosingYears.vue'
import { selectedOpenYear } from './closingPresentation'

// The fiscal years and, for the open year named by ?year=, its closing preview.
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const years = useFinanceFiscalYears(() => can('finance.closing.read'))
const setup = useFinanceSetup(() => can('finance.setup.read'))
const items = computed(() => years.data.value?.items ?? [])
const selected = computed(() => selectedOpenYear(route.query.year, items.value))
const currency = computed(() => setup.data.value?.company.currency)
</script>

<template>
  <SharedPageState :loading="years.isLoading.value" :error="years.error.value" :empty="!items.length" :empty-text="t('financeGovernance.closing.empty')" @retry="years.refetch">
    <div class="grid gap-(--webvue-gap-card)">
      <ClosingYears :years="items" :currency="currency" :selected="selected" />
      <ClosingPreview v-if="selected" :year="selected" :currency="currency" />
    </div>
  </SharedPageState>
</template>
