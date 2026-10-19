<script setup lang="ts">
import SetupChecklist from '@/components/finance/SetupChecklist.vue'
import { financeSetupProgress } from '@/composables/finance/financeSetupSteps'
import { useFinanceSetup, useLoadFinanceChart } from '@/composables/finance/useFinanceSetup'
import { saveErrorMessage } from '@/utils/formFeedback'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t, locale } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const canManage = computed(() => can('finance.setup.manage'))
const setup = useFinanceSetup(computed(() => can('finance.setup.read')))
const data = computed(() => setup.data.value)

const headerTags = computed<PageHeaderTag[]>(() => data.value
  ? [{ label: t(data.value.ready ? 'finance.setup.ready' : 'finance.setup.notReady'), tone: data.value.ready ? 'success' : 'warning', testId: 'finance-setup-state' }]
  : [])
const progress = computed(() => data.value ? financeSetupProgress(data.value) : null)

// Loading the chart is a one-time write that creates the company's accounts, taxes and journals, so it asks for an inline confirmation first.
const confirmChart = ref(false)
const chartError = ref<unknown>(null)
const { mutateAsync: loadChart, isPending: loadingChart } = useLoadFinanceChart()
async function confirmLoadChart() {
  if (!hydrated.value || loadingChart.value || !canManage.value) return
  try {
    await loadChart()
    confirmChart.value = false
    chartError.value = null
  } catch (failure) { chartError.value = failure }
}

function monthName(month: number) { return new Intl.DateTimeFormat(locale.value, { month: 'long' }).format(new Date(2000, month - 1, 1)) }
const LOCK_FIELDS = ['fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date', 'hard_lock_date'] as const
const ZATCA_TONE = { not_started: 'neutral', compliance_checked: 'info', onboarded: 'success' } as const
</script>

<template>
  <SharedSettingsPage width="detail">
    <SharedPageHeader :title="t('finance.setup.title')" :description="t('finance.setup.description')" :tags="headerTags" />
    <SharedPageState v-if="!can('finance.setup.read')" :empty="true" :empty-text="t('errors.forbidden')" />
    <SharedPageState v-else :loading="setup.isLoading.value" :error="setup.error.value" :empty="!data" @retry="setup.refetch">
      <div v-if="data" class="grid gap-(--webvue-gap-card)">
        <SharedRecordSection variant="panel" :title="t('finance.setup.stepsTitle')" :description="progress ? t('finance.overview.setupProgress', { done: progress.done, total: progress.total }) : undefined" data-testid="finance-setup-steps">
          <SetupChecklist :setup="data" />
        </SharedRecordSection>

        <SharedRecordSection variant="panel" :title="t('finance.setup.company.title')" :description="t('finance.setup.company.hint')" data-testid="finance-setup-company">
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('finance.setup.company.name')" :value="data.company.name" />
            <SharedPropertyRow v-if="data.company.vat" :label="t('finance.partners.form.vat')"><bdi dir="ltr">{{ data.company.vat }}</bdi></SharedPropertyRow>
            <SharedPropertyRow v-else :label="t('finance.partners.form.vat')" />
            <SharedPropertyRow v-if="data.company.company_registry" :label="t('finance.partners.form.companyRegistry')"><bdi dir="ltr">{{ data.company.company_registry }}</bdi></SharedPropertyRow>
            <SharedPropertyRow v-else :label="t('finance.partners.form.companyRegistry')" />
            <SharedPropertyRow :label="t('finance.partners.form.street')" :value="data.company.street" />
            <SharedPropertyRow :label="t('finance.partners.form.city')" :value="data.company.city" />
            <SharedPropertyRow :label="t('finance.partners.form.state')" :value="data.company.state?.name" />
            <SharedPropertyRow :label="t('finance.partners.form.country')" :value="data.company.country?.name" />
            <SharedPropertyRow :label="t('finance.setup.company.currency')"><bdi dir="ltr">{{ data.company.currency }}</bdi></SharedPropertyRow>
          </SharedPropertiesPanel>
        </SharedRecordSection>

        <SharedRecordSection variant="panel" :title="t('finance.setup.fiscal.title')" data-testid="finance-setup-fiscal">
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('finance.setup.fiscal.yearEnd')" :value="`${data.fiscal.fiscalyear_last_day} ${monthName(data.fiscal.fiscalyear_last_month)}`" />
            <SharedPropertyRow v-for="field in LOCK_FIELDS" :key="field" :label="t(`finance.setup.fiscal.${field}`)">
              <bdi v-if="data.fiscal[field]" dir="ltr">{{ data.fiscal[field] }}</bdi>
              <template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template>
            </SharedPropertyRow>
          </SharedPropertiesPanel>
        </SharedRecordSection>

        <SharedRecordSection variant="panel" :title="t('finance.setup.chart.title')" :description="t('finance.setup.chart.hint')" data-testid="finance-setup-chart">
          <template v-if="!data.chart.loaded && canManage" #actions>
            <UButton color="primary" icon="i-lucide-download" :disabled="!hydrated || confirmChart" :label="t('finance.setup.chart.load')" @click="confirmChart = true" />
          </template>
          <SharedInlineConfirm
            v-if="confirmChart"
            class="mb-3"
            color="primary"
            :title="t('finance.setup.chart.confirmTitle')"
            :description="chartError ? saveErrorMessage(chartError, t('errors.generic'), t('errors.saveUncertain')) : t('finance.setup.chart.confirmDescription')"
            :confirm-label="t('finance.setup.chart.load')"
            :pending="loadingChart"
            @confirm="confirmLoadChart"
            @cancel="confirmChart = false; chartError = null"
          />
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('finance.setup.chart.status')">
              <SharedStatusBadge size="sm" :tone="data.chart.loaded ? 'success' : 'warning'" :label="t(data.chart.loaded ? 'finance.setup.chart.loaded' : 'finance.setup.chart.notLoaded')" />
            </SharedPropertyRow>
            <SharedPropertyRow :label="t('finance.setup.chart.template')" :value="data.chart.template" />
            <SharedPropertyRow :label="t('finance.setup.chart.accounts')" :value="data.chart.accounts_count" />
            <SharedPropertyRow :label="t('finance.setup.chart.journals')" :value="t('finance.setup.chart.journalsValue', { sale: data.journals.sale, purchase: data.journals.purchase, bank: data.journals.bank, cash: data.journals.cash })" />
            <SharedPropertyRow :label="t('finance.setup.chart.taxes')" :value="t('finance.setup.chart.taxesValue', { sale: data.taxes.sale_count, purchase: data.taxes.purchase_count })" />
            <SharedPropertyRow :label="t('finance.setup.chart.vat15')">
              <SharedStatusBadge size="sm" :tone="data.taxes.vat_15_present ? 'success' : 'warning'" :label="t(data.taxes.vat_15_present ? 'finance.setup.yes' : 'finance.setup.no')" />
            </SharedPropertyRow>
          </SharedPropertiesPanel>
        </SharedRecordSection>

        <SharedRecordSection variant="panel" :title="t('finance.setup.zatca.title')" :description="t('finance.setup.zatca.hint')" data-testid="finance-setup-zatca">
          <SharedPropertiesPanel>
            <SharedPropertyRow :label="t('finance.setup.zatca.mode')" :value="t(`finance.setup.zatca.modes.${data.zatca.api_mode}`)" />
            <SharedPropertyRow :label="t('finance.setup.zatca.key')">
              <SharedStatusBadge size="sm" :tone="data.zatca.private_key_present ? 'success' : 'neutral'" :label="t(data.zatca.private_key_present ? 'finance.setup.yes' : 'finance.setup.no')" />
            </SharedPropertyRow>
            <SharedPropertyRow :label="t('finance.setup.zatca.onboarded')">
              <SharedStatusBadge size="sm" :tone="data.zatca.onboarded ? 'success' : 'warning'" :label="t(data.zatca.onboarded ? 'finance.setup.yes' : 'finance.setup.no')" />
            </SharedPropertyRow>
            <SharedPropertyRow v-for="journal in data.zatca.journals" :key="journal.journal.id" :label="journal.journal.name">
              <SharedStatusBadge size="sm" :tone="ZATCA_TONE[journal.state]" :label="t(`finance.setup.zatca.states.${journal.state}`)" />
            </SharedPropertyRow>
          </SharedPropertiesPanel>
        </SharedRecordSection>
      </div>
    </SharedPageState>
  </SharedSettingsPage>
</template>
