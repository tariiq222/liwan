<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrInsurancePlan, HrInsuranceProvider } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { isHrInsuranceConflict } from '@/composables/useHrInsurance'

// One plan's form: it creates inside /hr/insurance/plans/new (no `plan`) or edits the record page's plan.
// An edit sends only what changed with the revision it read; the provider of a plan never changes.
const props = defineProps<{
  providers: HrInsuranceProvider[]
  backTo: RouteLocationRaw
  plan?: HrInsurancePlan
}>()
const emit = defineEmits<{ saved: [plan: HrInsurancePlan] }>()

const { t } = useI18n()
const hydrated = useHydrated()
const create = useCreateHrInsurancePlan()
const patch = usePatchHrInsurancePlan()
const pending = computed(() => create.isPending.value || patch.isPending.value)

// The plan as the form opened on: its revision and values stay until a save succeeds, so a background refetch
// can neither advance the revision nor replace what is being typed (a concurrent edit then answers 409).
const baseline = ref(props.plan)
const providerId = ref<number | null>(props.plan?.provider.id ?? null)
const name = ref(props.plan?.name ?? '')
const tier = ref(props.plan?.tier ?? '')
const policyNumber = ref(props.plan?.policy_number ?? '')
const validFrom = ref<string | null>(props.plan?.valid_from ?? null)
const validTo = ref<string | null>(props.plan?.valid_to ?? null)
const premium = ref<number | undefined>(props.plan?.annual_premium ?? undefined)
const attempted = ref(false)
const saved = ref(false)
const error = ref('')
const serverField = ref('')

const providerOptions = computed(() => props.providers.map(provider => ({ value: String(provider.id), label: provider.name })))
const orderError = computed(() => validFrom.value && validTo.value && validTo.value < validFrom.value ? t('hrInsurance.form.datesOrder') : undefined)
const dirty = computed(() => {
  const base = baseline.value
  if (saved.value) return false
  if (!base) return Boolean(providerId.value || name.value || tier.value || policyNumber.value || validFrom.value || validTo.value || premium.value !== undefined)
  return name.value !== base.name || tier.value !== (base.tier ?? '') || policyNumber.value !== (base.policy_number ?? '')
    || validFrom.value !== base.valid_from || validTo.value !== base.valid_to || premium.value !== (base.annual_premium ?? undefined)
})
const conflict = ref(false)

function fill(plan: HrInsurancePlan) {
  baseline.value = plan
  name.value = plan.name
  tier.value = plan.tier ?? ''
  policyNumber.value = plan.policy_number ?? ''
  validFrom.value = plan.valid_from
  validTo.value = plan.valid_to
  premium.value = plan.annual_premium ?? undefined
}
// After a conflict the form takes the latest plan the page loaded, then the manager repeats the edit.
function reload() {
  if (props.plan) fill(props.plan)
  conflict.value = false
  error.value = ''
}

function fieldError(field: string) {
  return serverField.value === field ? error.value : undefined
}
const providerError = computed(() => attempted.value && !providerId.value ? t('hrInsurance.form.providerRequired') : fieldError('provider_id'))
const nameError = computed(() => attempted.value && !name.value.trim() ? t('hrInsurance.form.nameRequired') : fieldError('name'))
const datesError = computed(() => orderError.value ?? (attempted.value && (!validFrom.value || !validTo.value) ? t('hrInsurance.form.datesRequired') : fieldError('valid_from') ?? fieldError('valid_to')))

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = ''
  serverField.value = ''
  if (!name.value.trim() || !validFrom.value || !validTo.value || orderError.value || (!baseline.value && !providerId.value)) return
  try {
    const body = {
      name: name.value.trim(),
      tier: tier.value.trim(),
      policy_number: policyNumber.value.trim(),
      valid_from: validFrom.value,
      valid_to: validTo.value,
      annual_premium: premium.value ?? 0,
    }
    const base = baseline.value
    const plan = base
      ? await patch.mutateAsync({ id: base.id, body: { ...body, revision: base.revision } })
      : await create.mutateAsync({ ...body, provider_id: providerId.value! })
    if (base) fill(plan)
    else saved.value = true
    await nextTick()
    emit('saved', plan)
  } catch (cause) {
    conflict.value = isHrInsuranceConflict(cause)
    error.value = isHrInsuranceConflict(cause) ? t('hrInsurance.conflict') : cause instanceof ApiError ? cause.message : t('errors.generic')
    serverField.value = cause instanceof ApiError && !isHrInsuranceConflict(cause) ? cause.field ?? '' : ''
  }
}
</script>

<template>
  <UForm novalidate :state="{ providerId, name, tier, policyNumber, validFrom, validTo, premium }" class="liwan-form" method="post" data-testid="hr-insurance-plan-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="error && !serverField" role="alert" color="error" variant="subtle" :title="error">
      <template v-if="conflict" #actions><UButton type="button" color="neutral" variant="outline" size="sm" :label="t('hrInsurance.reload')" data-testid="hr-insurance-plan-form-reload" @click="reload" /></template>
    </UAlert>
    <SharedFormSection panel :title="t('hrInsurance.form.planDetails')">
      <div class="grid gap-4">
        <UFormField :label="t('hrInsurance.form.provider')" name="hr-insurance-provider" required :error="providerError" :hint="providerOptions.length ? undefined : t('hrInsurance.form.noProviders')">
          <USelect id="hr-insurance-provider" class="w-full" :model-value="providerId ? String(providerId) : undefined" :items="providerOptions" :placeholder="t('hrInsurance.form.chooseProvider')" :disabled="!hydrated || pending || !!props.plan" data-testid="hr-insurance-provider" @update:model-value="providerId = $event ? Number($event) : null" />
        </UFormField>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.form.planName')" name="hr-insurance-plan-name" required :error="nameError">
            <UInput id="hr-insurance-plan-name" v-model="name" class="w-full" :disabled="!hydrated || pending" data-testid="hr-insurance-plan-name" />
          </UFormField>
          <UFormField :label="t('hrInsurance.form.tier')" name="hr-insurance-tier" :hint="t('hrInsurance.form.tierHint')">
            <UInput id="hr-insurance-tier" v-model="tier" class="w-full" :disabled="!hydrated || pending" data-testid="hr-insurance-tier" />
          </UFormField>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.form.validFrom')" name="hr-insurance-valid-from" required :error="datesError">
            <SharedDateField id="hr-insurance-valid-from" v-model="validFrom" :disabled="!hydrated || pending" />
          </UFormField>
          <UFormField :label="t('hrInsurance.form.validTo')" name="hr-insurance-valid-to" required>
            <SharedDateField id="hr-insurance-valid-to" v-model="validTo" :disabled="!hydrated || pending" />
          </UFormField>
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField :label="t('hrInsurance.form.policyNumber')" name="hr-insurance-policy-number">
            <UInput id="hr-insurance-policy-number" v-model="policyNumber" class="w-full" dir="ltr" :disabled="!hydrated || pending" data-testid="hr-insurance-policy-number" />
          </UFormField>
          <UFormField :label="t('hrInsurance.form.premium')" name="hr-insurance-premium" :hint="t('hrInsurance.form.premiumHint')">
            <UInputNumber id="hr-insurance-premium" v-model="premium" class="w-full" :min="0" :disabled="!hydrated || pending" data-testid="hr-insurance-premium" />
          </UFormField>
        </div>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('hrInsurance.form.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || pending" :loading="pending" :label="t(props.plan ? 'app.saveChanges' : 'hrInsurance.form.submitPlan')" data-testid="hr-insurance-plan-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
