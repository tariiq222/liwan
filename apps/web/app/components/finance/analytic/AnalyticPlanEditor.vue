<script setup lang="ts">
import type { FinanceAnalyticPlan } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { useCreateAnalyticPlan, useRenameAnalyticPlan } from '@/composables/finance/useFinanceAnalytic'
import { mustChooseParent } from './analyticAccess'

// The inline form of the plans section: a new plan (name and optional parent) or the new name of an existing one.
// A parent is the only way to add a plan without `finance.setup.manage`, so the form then requires one.
const props = defineProps<{ plan?: FinanceAnalyticPlan; plans: readonly FinanceAnalyticPlan[] }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const NO_PARENT = 'none'
const name = ref(props.plan?.name ?? '')
const parent = ref(mustChooseParent(can) ? String(props.plans[0]?.id ?? NO_PARENT) : NO_PARENT)
const failure = ref<unknown>(null)
const { mutateAsync: create, isPending: creating } = useCreateAnalyticPlan()
const { mutateAsync: rename, isPending: renaming } = useRenameAnalyticPlan()
const pending = computed(() => creating.value || renaming.value)
const parentItems = computed(() => [
  ...(mustChooseParent(can) ? [] : [{ value: NO_PARENT, label: t('financeAnalytic.plans.form.noParent') }]),
  ...props.plans.map(plan => ({ value: String(plan.id), label: plan.name })),
])
const valid = computed(() => name.value.trim() !== '' && (!!props.plan || !mustChooseParent(can) || parent.value !== NO_PARENT))

async function submit() {
  if (!hydrated.value || pending.value || !valid.value) return
  try {
    if (props.plan) await rename({ id: props.plan.id, patch: { name: name.value.trim() } })
    else await create({ name: name.value.trim(), ...(parent.value === NO_PARENT ? {} : { parent_id: Number(parent.value) }) })
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm :state="{ name }" class="webvue-form" method="post" :loading-auto="false" novalidate data-testid="finance-analytic-plan-form" @submit="submit">
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('financeAnalytic.saveError')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <div class="webvue-form-grid">
      <UFormField :label="t('financeAnalytic.plans.form.name')" name="finance-analytic-plan-name" required>
        <UInput id="finance-analytic-plan-name" v-model="name" class="w-full" :disabled="!hydrated" required />
      </UFormField>
      <UFormField v-if="!plan" :label="t('financeAnalytic.plans.form.parent')" name="finance-analytic-plan-parent" :hint="t(mustChooseParent(can) ? 'financeAnalytic.plans.form.parentRequired' : 'financeAnalytic.plans.form.parentOptional')">
        <USelect id="finance-analytic-plan-parent" v-model="parent" class="w-full" :items="parentItems" :disabled="!hydrated" />
      </UFormField>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :disabled="pending" :label="t('app.cancel')" @click="emit('cancel')" />
      <UButton type="submit" color="primary" :disabled="!hydrated || !valid" :loading="pending" :label="t('app.save')" data-testid="finance-analytic-plan-save" />
    </div>
  </UForm>
</template>
