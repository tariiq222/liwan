<script setup lang="ts">
import type { CompanyTax } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useSaveCompanyTax } from '@/composables/useCompanyTax'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'
import { chooseOption, chosenOption, optionLocked, taxDraft, taxErrorKey, taxUpdate, type CompanyTaxChoice, type CompanyTaxDraft, type CompanyTaxPriceMode } from '@/composables/companyTax'

// The establishment's one tax choice: whether it is registered for VAT and what the price typed on a product means.
// Stock stores the price mode once and locks it after the first accounting entry, so the card states the lock before
// anything is saved and disables the mode that can no longer change. A branch session reads it and says it is changed
// from the main company; a holder without the VAT right reads it and says so.
const props = defineProps<{ tax: CompanyTax; vatNumber: string | null; reloadTax: () => Promise<CompanyTax> }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: saveTax } = useSaveCompanyTax()

const canEdit = computed(() => props.tax.can_change)
// Why the card is read-only, from the real fact: a branch changes it from the main company; a root session without the
// VAT right names the missing permission; a root session that holds the right and is still refused is in a read-only
// state (seat or subscription), whose own notice the shell shows, so the card adds no reason of its own.
const readOnlyReason = computed(() => {
  if (!props.tax.is_root_session) return t('settings.company.tax.changedFromRoot')
  return can('settings.company.vat.manage') ? undefined : t('settings.company.vatManageHint')
})

const { draft, state, save, revert, reload } = useSettingsForm<CompanyTax, CompanyTaxDraft>({
  source: () => props.tax,
  read: taxDraft,
  save: async (values, latest) => {
    const patch = taxUpdate(latest, values)
    if (!patch) return latest
    // Registering needs the VAT number of the company profile, the same rule the profile card states first.
    if (patch.registered && !String(props.vatNumber ?? '').trim()) {
      throw new ApiError(422, 'invalid_vat', t('settings.company.errors.vatRequired'), 'vat')
    }
    try {
      const saved = await saveTax(patch)
      toast.add({ title: t('settings.company.tax.saved'), color: 'success' })
      return saved
    } catch (error) {
      // The server's own text is developer-facing; the card shows the owning locale message in either language.
      const key = taxErrorKey(error)
      if (!key) throw error
      const status = error instanceof ApiError ? error.status : 0
      const code = error instanceof ApiError ? error.code : 'http_error'
      throw new ApiError(status, code, t(key))
    }
  },
  reload: () => props.reloadTax(),
})
const locked = computed(() => !hydrated.value || !canEdit.value || state.value.saving || state.value.reloading)
const selection = computed(() => chosenOption(draft.value))

function option(choice: CompanyTaxChoice) {
  const disabled = optionLocked(props.tax, choice)
  return {
    value: choice,
    label: t(`settings.company.tax.choices.${choice}.label`),
    description: t(`settings.company.tax.choices.${choice}.hint`),
    disabled,
    disabledReason: disabled ? t('settings.company.tax.lockedOption') : undefined,
  }
}
const choices = computed(() => (['none', 'included', 'added'] as const).map(option))
const priceModes = computed(() => (['included', 'added'] as const).map(option))

function pick(choice: string) {
  const next = chooseOption(draft.value, choice as CompanyTaxChoice)
  draft.value.registered = next.registered
  draft.value.priceMode = next.priceMode
}
function pickFutureMode(mode: string) {
  draft.value.priceMode = mode as CompanyTaxPriceMode
}
</script>

<template>
  <SharedSettingsCard id="tax" v-bind="state" :title="t('settings.company.tax.title')" :description="t('settings.company.tax.hint')" :can-edit="canEdit" data-testid="company-tax" @save="save" @revert="revert" @reload="reload">
    <UAlert v-if="!canEdit && readOnlyReason" color="info" variant="subtle" icon="i-lucide-lock" :description="readOnlyReason" data-testid="company-tax-readonly" />
    <SharedOptionCards :model-value="selection" :options="choices" :disabled="locked" :label="t('settings.company.tax.question')" data-testid="company-tax-choice" @update:model-value="pick" />
    <div v-if="!draft.registered" class="flex flex-col gap-2" data-testid="company-tax-future-mode">
      <p class="text-sm font-medium text-highlighted">{{ t('settings.company.tax.futureMode.question') }}</p>
      <p class="text-xs text-muted">{{ t('settings.company.tax.futureMode.hint') }}</p>
      <SharedOptionCards :model-value="draft.priceMode" :options="priceModes" :disabled="locked" :label="t('settings.company.tax.futureMode.question')" data-testid="company-tax-price-mode" @update:model-value="pickFutureMode" />
    </div>
    <UAlert color="warning" variant="subtle" icon="i-lucide-triangle-alert" :description="t('settings.company.tax.lockNotice')" data-testid="company-tax-lock" />
  </SharedSettingsCard>
</template>
