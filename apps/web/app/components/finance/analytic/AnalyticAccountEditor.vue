<script setup lang="ts">
import type { FinanceAnalyticAccount, FinanceAnalyticPlan } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useCreateAnalyticAccount, usePatchAnalyticAccount } from '@/composables/finance/useFinanceAnalytic'
import { accountPatch } from './analyticForms'

// The inline form of the cost center section: a new cost center (name, code, plan) or the name and code of an existing
// one. The plan is chosen once: moving a cost center to another plan is refused by the server once it has items.
const props = defineProps<{ account?: FinanceAnalyticAccount; plans: readonly FinanceAnalyticPlan[] }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const name = ref(props.account?.name ?? '')
const code = ref(props.account?.code ?? '')
const planId = ref(String(props.plans[0]?.id ?? ''))
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateAnalyticAccount()
const { mutateAsync: patch, isPending: patching } = usePatchAnalyticAccount()
const pending = computed(() => creating.value || patching.value)
const planItems = computed(() => props.plans.map(plan => ({ value: String(plan.id), label: plan.name })))
const valid = computed(() => name.value.trim() !== '' && (!!props.account || planId.value !== ''))

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.account) {
      const changes = accountPatch(props.account, name.value, code.value)
      if (changes) await patch({ id: props.account.id, patch: changes })
    } else {
      await create({ name: name.value.trim(), plan_id: Number(planId.value), ...(code.value.trim() ? { code: code.value.trim() } : {}) })
    }
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="{ name, code }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="finance-analytic-account-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeAnalytic.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="liwan-form-grid">
      <UFormField :label="t('financeAnalytic.accounts.form.name')" name="finance-analytic-account-name" required>
        <UInput id="finance-analytic-account-name" v-model="name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField :label="t('financeAnalytic.accounts.form.code')" name="finance-analytic-account-code">
        <UInput id="finance-analytic-account-code" v-model="code" dir="ltr" class="w-full" :disabled="!hydrated" />
      </UFormField>
      <UFormField v-if="!account" :label="t('financeAnalytic.accounts.form.plan')" name="finance-analytic-account-plan" required>
        <USelect id="finance-analytic-account-plan" v-model="planId" class="w-full" :items="planItems" :disabled="!hydrated" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-analytic-account-save" />
    </div>
  </UForm>
</template>
