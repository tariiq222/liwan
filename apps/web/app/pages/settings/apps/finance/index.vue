<script setup lang="ts">
import SettingsPreviewCard from '@/components/settings/SettingsPreviewCard.vue'
import SetupChecklist from '@/components/finance/SetupChecklist.vue'
import AnalyticAccountsSection from '@/components/finance/analytic/AnalyticAccountsSection.vue'
import AnalyticPlansSection from '@/components/finance/analytic/AnalyticPlansSection.vue'
import AuditPreview from '@/components/finance/governance/AuditPreview.vue'
import ClosingView from '@/components/finance/governance/ClosingView.vue'
import ZatcaView from '@/components/finance/governance/ZatcaView.vue'
import { financeSetupProgress } from '@/composables/finance/financeSetupSteps'
import { useFinanceSetup, useLoadFinanceChart, useSaveFinanceFiscal } from '@/composables/finance/useFinanceSetup'
import {
  FINANCE_FISCAL_LOCK_FIELDS,
  emptyFinanceFiscalDraft,
  financeFiscalDelta,
  financeFiscalDirty,
  financeFiscalDraftFromValues,
  financeFiscalFieldError,
  financeFiscalIssues,
  financeFiscalSaveMessage,
  isFinanceContextChanged,
  sameFinanceSetupScope,
  type FinanceFiscalDraft,
  type FinanceFiscalField,
  type FinanceSetupScope,
} from '@/composables/finance/financeFiscalSetup'
import { saveErrorMessage } from '@/utils/formFeedback'
import type { PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'

const { t, locale } = useI18n()
const { can } = useAccess()
const { parts, shows } = useSettingsPage('finance')
const hydrated = useHydrated()
const canManage = computed(() => can('finance.setup.manage'))
const setup = useFinanceSetup(computed(() => can('finance.setup.read')))
const data = computed(() => setup.data.value)

// The finance settings: one page of cards. Setup is the first; analytic accounting, fiscal closing and e-invoicing follow;
// the audit log is a preview with a link to its full page.
const headerTags = computed<PageHeaderTag[]>(() => data.value
  ? [{ label: t(data.value.ready ? 'finance.setup.ready' : 'finance.setup.notReady'), tone: data.value.ready ? 'success' : 'warning', testId: 'finance-setup-state' }]
  : [])
const progress = computed(() => data.value ? financeSetupProgress(data.value) : null)

// Loading the chart is a one-time write that creates the company's accounts, taxes and journals, so it asks for an inline confirmation first.
const confirmChart = ref(false)
const chartError = ref<unknown>(null)
const { mutateAsync: loadChart, isPending: loadingChart } = useLoadFinanceChart()
async function confirmLoadChart() {
  const target = setup.scope.value
  if (!hydrated.value || loadingChart.value || !canManage.value || !target) return
  try {
    await loadChart(target)
    confirmChart.value = false
    chartError.value = null
  } catch (failure) { chartError.value = failure }
}

// The fiscal editor: an immutable baseline of the values this identity was read for, and a draft of the
// changes on top of it. The card stays inline in place; there is no second form and no optimistic save.
const fiscalBaseline = ref<FinanceFiscalDraft | null>(null)
const fiscalDraft = ref<FinanceFiscalDraft>(emptyFinanceFiscalDraft())
const fiscalAttempted = ref(false)
const fiscalError = ref<unknown>(null)
const fiscalNoticeKey = ref<string | null>(null)
const fiscalSaved = ref(false)
// The identity the draft was read for, captured when the draft starts: the precondition states this one,
// never whatever the session happens to be when the save button is pressed.
const draftScope = ref<FinanceSetupScope | null>(null)
const { mutateAsync: saveFiscal, isPending: savingFiscal } = useSaveFinanceFiscal()

const fiscalDirty = computed(() => !!fiscalBaseline.value && financeFiscalDirty(fiscalDraft.value, fiscalBaseline.value))
const fiscalIssues = computed(() => fiscalBaseline.value ? financeFiscalIssues(fiscalDraft.value, fiscalBaseline.value) : [])
const fiscalIssuesByField = computed(() => new Map(fiscalIssues.value.map(issue => [issue.field, issue.code])))
const fiscalDisabled = computed(() => !hydrated.value || !canManage.value || savingFiscal.value)

/** The message under one field: what this draft breaks, or what the server refused, once a save was tried. */
function fiscalFieldMessage(field: FinanceFiscalField) {
  const refused = financeFiscalFieldError(fiscalError.value, field, t)
  if (refused) return refused
  if (!fiscalAttempted.value) return undefined
  const code = fiscalIssuesByField.value.get(field)
  return code ? t(`finance.setup.fiscal.errors.${code}`) : undefined
}

function seedFiscal(values: NonNullable<typeof setup.data.value>, scope: FinanceSetupScope) {
  const baseline = financeFiscalDraftFromValues(values.fiscal)
  fiscalBaseline.value = baseline
  fiscalDraft.value = { ...baseline }
  draftScope.value = scope
  fiscalAttempted.value = false
  fiscalError.value = null
  fiscalNoticeKey.value = null
  fiscalSaved.value = false
}

/** Drop a draft that no longer belongs to the identity on screen: it is never carried to another one. */
function discardFiscal() {
  fiscalBaseline.value = null
  fiscalDraft.value = emptyFinanceFiscalDraft()
  draftScope.value = null
  fiscalAttempted.value = false
  fiscalError.value = null
  fiscalNoticeKey.value = null
  fiscalSaved.value = false
}

// A new identity seeds its own baseline and drops the old draft; a background refetch of the same identity
// never replaces a dirty draft with the server's copy.
watch([setup.data, setup.scope], ([values, scope]) => {
  if (!values || !scope) { discardFiscal(); return }
  if (!sameFinanceSetupScope(draftScope.value, scope) || !fiscalDirty.value) seedFiscal(values, scope)
}, { immediate: true })

function revertFiscal() {
  if (!fiscalBaseline.value || savingFiscal.value) return
  fiscalDraft.value = { ...fiscalBaseline.value }
  fiscalAttempted.value = false
  fiscalError.value = null
  fiscalNoticeKey.value = null
  fiscalSaved.value = false
}

async function focusFirstFiscalIssue() {
  await nextTick()
  const field = fiscalIssues.value[0]?.field
  if (field) document.getElementById(`finance-fiscal-${field}`)?.focus()
}

// Saves the changed fields only. A draft that breaks a rule sends nothing, an unchanged draft never reaches
// the network, and the precondition states the identity the draft was read for. A screen that moved on since
// then sends nothing at all, and an answer that arrives for another identity is dropped.
async function submitFiscal() {
  const target = draftScope.value
  const baseline = fiscalBaseline.value
  if (fiscalDisabled.value || !target || !baseline) return
  if (!sameFinanceSetupScope(target, setup.scope.value)) return
  fiscalAttempted.value = true
  fiscalSaved.value = false
  fiscalNoticeKey.value = null
  if (fiscalIssues.value.length) { fiscalError.value = null; await focusFirstFiscalIssue(); return }
  const delta = financeFiscalDelta(fiscalDraft.value, baseline)
  if (!delta) return
  try {
    const saved = await saveFiscal({ delta, scope: target })
    if (!sameFinanceSetupScope(target, setup.scope.value)) return
    seedFiscal(saved, target)
    fiscalSaved.value = true
  } catch (failure) {
    fiscalError.value = failure
    if (isFinanceContextChanged(failure)) {
      // The screen no longer speaks for this draft: hide it and say so instead of presenting it as saved.
      discardFiscal()
      fiscalNoticeKey.value = 'finance.setup.fiscal.errors.request_context_changed'
    }
  }
}

// A save in flight owns the screen: leaving now would abandon a request whose outcome is unknown, and the
// shared draft guard must not be taken as permission to walk away from it.
onBeforeRouteLeave(() => {
  if (!savingFiscal.value) return true
  fiscalNoticeKey.value = 'finance.setup.fiscal.saving'
  return false
})

function monthName(month: number) { return new Intl.DateTimeFormat(locale.value, { month: 'long' }).format(new Date(2000, month - 1, 1)) }
const monthOptions = computed(() => Array.from({ length: 12 }, (_, index) => ({ value: String(index + 1), label: monthName(index + 1) })))
const LOCK_FIELDS = ['fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date', 'hard_lock_date'] as const
const ZATCA_TONE = { not_started: 'neutral', compliance_checked: 'info', onboarded: 'success' } as const
</script>

<template>
  <SharedSettingsPage width="detail">
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

        <SharedRecordSection variant="panel" :title="t('finance.setup.fiscal.title')" :description="t('finance.setup.fiscal.scopeHint')" data-testid="finance-setup-fiscal">
          <UForm
            v-if="canManage"
            :state="fiscalDraft"
            class="webvue-form"
            method="post"
            :loading-auto="false"
            novalidate
            @submit="submitFiscal"
          >
            <UAlert v-if="fiscalNoticeKey" role="alert" color="error" variant="subtle" :description="t(fiscalNoticeKey)" />
            <UAlert v-else-if="fiscalError" role="alert" color="error" variant="subtle" :title="t('finance.setup.fiscal.saveError')" :description="financeFiscalSaveMessage(fiscalError, t)" />
            <UAlert v-else-if="fiscalSaved" role="status" color="success" variant="subtle" :description="t('finance.setup.fiscal.saved')" />
            <div class="webvue-form-grid">
              <UFormField :label="t('finance.setup.fiscal.yearEndDay')" name="finance-fiscal-fiscalyear_last_day" :error="fiscalFieldMessage('fiscalyear_last_day')">
                <UInput id="finance-fiscal-fiscalyear_last_day" v-model="fiscalDraft.fiscalyear_last_day" class="w-full" dir="ltr" inputmode="numeric" :disabled="fiscalDisabled" />
              </UFormField>
              <UFormField :label="t('finance.setup.fiscal.yearEndMonth')" name="finance-fiscal-fiscalyear_last_month" :error="fiscalFieldMessage('fiscalyear_last_month')">
                <USelect id="finance-fiscal-fiscalyear_last_month" v-model="fiscalDraft.fiscalyear_last_month" class="w-full" :items="monthOptions" :disabled="fiscalDisabled" />
              </UFormField>
            </div>
            <p class="text-xs text-muted">{{ t('finance.setup.fiscal.yearEndHint') }}</p>
            <p class="text-xs text-muted">{{ t('finance.setup.fiscal.locksHint') }}</p>
            <div class="webvue-form-grid">
              <UFormField
                v-for="field in FINANCE_FISCAL_LOCK_FIELDS"
                :key="field"
                :label="t(`finance.setup.fiscal.${field}`)"
                :name="`finance-fiscal-${field}`"
                :error="fiscalFieldMessage(field)"
              >
                <SharedDateField
                  :id="`finance-fiscal-${field}`"
                  v-model="fiscalDraft[field]"
                  :min-value="fiscalBaseline ? fiscalBaseline[field] : null"
                  :disabled="fiscalDisabled"
                  :aria-label="t(`finance.setup.fiscal.${field}`)"
                />
              </UFormField>
            </div>
            <SharedFormActions>
              <span class="me-auto text-xs text-muted">{{ t('finance.setup.fiscal.hardLockHint') }}</span>
              <UButton type="button" color="neutral" variant="outline" :disabled="fiscalDisabled || !fiscalDirty" :label="t('finance.setup.fiscal.revert')" @click="revertFiscal" />
              <UButton type="submit" color="primary" :disabled="fiscalDisabled || !fiscalDirty" :loading="savingFiscal" :label="t('app.saveChanges')" />
            </SharedFormActions>
          </UForm>
          <SharedPropertiesPanel v-else>
            <SharedPropertyRow :label="t('finance.setup.fiscal.yearEnd')" :value="`${data.fiscal.fiscalyear_last_day} ${monthName(data.fiscal.fiscalyear_last_month)}`" />
            <SharedPropertyRow v-for="field in LOCK_FIELDS" :key="field" :label="t(`finance.setup.fiscal.${field}`)">
              <bdi v-if="data.fiscal[field]" dir="ltr">{{ data.fiscal[field] }}</bdi>
              <template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template>
            </SharedPropertyRow>
          </SharedPropertiesPanel>
          <SharedPropertiesPanel v-if="canManage">
            <SharedPropertyRow :label="t('finance.setup.fiscal.hard_lock_date')">
              <bdi v-if="data.fiscal.hard_lock_date" dir="ltr">{{ data.fiscal.hard_lock_date }}</bdi>
              <template v-else><span aria-hidden="true" class="text-muted">—</span><span class="sr-only">{{ t('states.noValue') }}</span></template>
            </SharedPropertyRow>
          </SharedPropertiesPanel>
          <SharedUnsavedChanges :dirty="canManage && (fiscalDirty || savingFiscal)" />
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
