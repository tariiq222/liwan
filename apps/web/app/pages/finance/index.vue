<script setup lang="ts">
import SetupChecklist from '@/components/finance/SetupChecklist.vue'
import DraftDocumentList from '@/components/finance/DraftDocumentList.vue'
import { financeOverviewTiles } from '@/composables/finance/financeKpis'
import { financeSetupProgress } from '@/composables/finance/financeSetupSteps'
import { useFinancePartners } from '@/composables/finance/useFinancePartners'
import { useFinanceAging, useFinanceDrafts } from '@/composables/finance/useFinanceOverview'
import { useFinanceSetup } from '@/composables/finance/useFinanceSetup'

const { t, n } = useI18n()
const { can } = useAccess()

// Every tile is a server total: list requests that ask for one row (their `total`) and the aged-balance report. A tile behind a
// capability the viewer lacks is left out instead of showing a dash.
const canInvoices = computed(() => can('finance.invoices.read'))
const canStatements = computed(() => can('finance.statements.read'))
const canPartners = computed(() => can('finance.partners.read'))
const canSetup = computed(() => can('finance.setup.read'))
// Hidden tiles ask nothing; the drafts stay because the attention card below lists them.
const { shown: kpisShown } = useKpiVisibility()
const drafts = useFinanceDrafts(5, canInvoices)
const receivable = useFinanceAging('receivable', computed(() => kpisShown.value && canStatements.value))
const payable = useFinanceAging('payable', computed(() => kpisShown.value && canStatements.value))
const partners = useFinancePartners({ limit: 1 }, computed(() => kpisShown.value && canPartners.value))
const setup = useFinanceSetup(canSetup)

const tiles = computed(() => financeOverviewTiles({
  receivable: canStatements.value ? (receivable.data.value ? { total: receivable.data.value.totals.total, currency: receivable.data.value.currency } : null) : undefined,
  payable: canStatements.value ? (payable.data.value ? { total: payable.data.value.totals.total, currency: payable.data.value.currency } : null) : undefined,
  drafts: canInvoices.value ? drafts.data.value?.total ?? null : undefined,
  partners: canPartners.value ? partners.data.value?.total ?? null : undefined,
}, t, n))
const loadingTiles = computed(() => [drafts, receivable, payable, partners].some(query => query.isLoading.value))
const progress = computed(() => setup.data.value ? financeSetupProgress(setup.data.value) : null)
</script>

<template>
  <SharedListPage :title="t('finance.overview.title')" :description="t('finance.overview.description')" kpi-toggle>
    <div class="webvue-page-stack">
      <SharedKpiStrip :tiles="tiles" :loading="loadingTiles" :label="t('finance.kpi.label')" data-testid="finance-kpi-strip" />
      <div class="grid gap-(--webvue-gap-card) lg:grid-cols-2">
        <SharedRecordSection
          v-if="canSetup"
          variant="panel"
          :title="t('finance.overview.setupTitle')"
          :description="progress ? t('finance.overview.setupProgress', { done: progress.done, total: progress.total }) : undefined"
          data-testid="finance-setup-card"
        >
          <SharedPageState :loading="setup.isLoading.value" :error="setup.error.value" @retry="setup.refetch">
            <p v-if="setup.data.value?.ready" class="text-sm text-muted">{{ t('finance.overview.setupReady') }}</p>
            <SetupChecklist v-else-if="setup.data.value" :setup="setup.data.value" />
          </SharedPageState>
        </SharedRecordSection>
        <SharedRecordSection
          v-if="canInvoices"
          variant="list"
          :title="t('finance.overview.attentionTitle')"
          :description="t('finance.overview.attentionDescription')"
          data-testid="finance-attention-card"
        >
          <SharedPageState class="m-(--webvue-card-pad-dense)" :loading="drafts.isLoading.value" :error="drafts.error.value" :empty="!drafts.data.value?.items.length" :empty-text="t('finance.overview.attentionEmpty')" @retry="drafts.refetch">
            <DraftDocumentList :rows="drafts.data.value?.items ?? []" />
          </SharedPageState>
        </SharedRecordSection>
      </div>
    </div>
  </SharedListPage>
</template>
