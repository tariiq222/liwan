<script setup lang="ts">
import BranchStrictCard from '@/components/access/branches/BranchStrictCard.vue'
import SettingsPreviewCard from '@/components/settings/SettingsPreviewCard.vue'
import SetupChecklist from '@/components/finance/SetupChecklist.vue'
import AnalyticAccountsSection from '@/components/finance/analytic/AnalyticAccountsSection.vue'
import AnalyticPlansSection from '@/components/finance/analytic/AnalyticPlansSection.vue'
import AuditPreview from '@/components/finance/governance/AuditPreview.vue'
import ClosingView from '@/components/finance/governance/ClosingView.vue'
import ZatcaView from '@/components/finance/governance/ZatcaView.vue'
import FiscalSetupCard from '@/components/finance/FiscalSetupCard.vue'
import { financeSetupProgress } from '@/composables/finance/financeSetupSteps'
import { financeSetupScopeToken } from '@/composables/finance/financeFiscalSetup'
import { useFinanceSetup } from '@/composables/finance/useFinanceSetup'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('finance')
const canManage = computed(() => can('finance.setup.manage'))
const setup = useFinanceSetup(computed(() => can('finance.setup.read')))
const data = computed(() => setup.data.value)

// The finance settings: one page of cards. Setup is the first; analytic accounting, fiscal closing and e-invoicing follow;
// the audit log is a preview with a link to its full page.
const headerTags = computed<PageHeaderTag[]>(() => data.value
  ? [{ label: t(data.value.ready ? 'finance.setup.ready' : 'finance.setup.notReady'), tone: data.value.ready ? 'success' : 'warning', testId: 'finance-setup-state' }]
  : [])
const progress = computed(() => data.value ? financeSetupProgress(data.value) : null)

// The fiscal card belongs to one identity: another user or company mounts it again, so its draft never moves to it.
const fiscalScope = computed(() => (data.value ? setup.scope.value : null))
// Set when a write was refused because the company or sign-in changed; the setup is read again for the current identity.
const contextChanged = ref(false)
function onContextChanged() {
  contextChanged.value = true
  void setup.refetch()
}
async function reloadSetup() {
  const result = await setup.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
const ZATCA_TONE = { not_started: 'neutral', compliance_checked: 'info', onboarded: 'success' } as const
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('nav.finance')" :tags="headerTags" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
    <section v-if="shows('setup')" id="setup" class="webvue-settings-anchor">
    <SharedPageState :loading="setup.isLoading.value" :error="setup.error.value" :empty="!data" @retry="setup.refetch">
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

        <BranchStrictCard scope="finance" path="/api/v1/finance/branch-strictness" :can-read="can('finance.setup.read')" :can-edit="canManage" />

        <FiscalSetupCard v-if="fiscalScope" :key="financeSetupScopeToken(fiscalScope)" :setup="data" :scope="fiscalScope" :can-edit="canManage" :context-changed="contextChanged" :reload-setup="reloadSetup" @context-changed="onContextChanged" @saved="contextChanged = false" />

        <SharedRecordSection variant="panel" :title="t('finance.setup.chart.title')" :description="t('finance.setup.chart.hint')" data-testid="finance-setup-chart">
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
    </section>

    <section v-if="shows('analytic')" id="analytic" class="webvue-settings-anchor grid gap-(--webvue-gap-card)">
      <AnalyticPlansSection />
      <AnalyticAccountsSection />
    </section>
    <section v-if="shows('closing')" id="closing" class="webvue-settings-anchor"><ClosingView /></section>
    <section v-if="shows('zatca')" id="zatca" class="webvue-settings-anchor"><ZatcaView /></section>
    <section v-if="shows('audit')" id="audit" class="webvue-settings-anchor">
      <SettingsPreviewCard :title="t('financeGovernance.audit.title')" :all-label="t('settings.preview.allAudit')" all-to="/settings/apps/finance/audit" test-id="finance-audit-card">
        <AuditPreview />
      </SettingsPreviewCard>
    </section>
    </template>
  </SharedSettingsPage>
</template>
