<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import { HrPayrollRunCreateSchema, type HrPayrollRun } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { saveErrorMessage } from '@/utils/formFeedback'
import { normalizeDigits } from '@/utils/moneyInput'
import { currentPayrollMonth, formatPayrollMonth } from '@/utils/payrollFormat'

// The create form of one payroll run, inside the /hr/payroll/new SharedCreatePanel. It only asks for the month,
// asks to confirm the month by name, posts it, shows the server's refusal (a month that already has a run) and reports the created run; the page owns
// the navigation.
const props = defineProps<{ backTo: RouteLocationRaw }>()
const emit = defineEmits<{ saved: [run: HrPayrollRun] }>()

const { t, locale } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: createRun, isPending } = useCreateHrPayrollRun()

const month = ref('')
const initialMonth = ref('')
// Filled after mount from the browser's own month: the server's clock can sit in another time zone, so the same
// value must never be server-rendered into the field. `initialMonth` is what the untouched form compares against.
onMounted(() => {
  initialMonth.value = currentPayrollMonth()
  month.value ||= initialMonth.value
})
const attempted = ref(false)
// The month is prefilled with the current one, so a run is never created before the month is named back to the user.
const confirming = ref(false)
const saved = ref(false)
const failure = ref<unknown>(null)
const dirty = computed(() => !saved.value && month.value !== initialMonth.value)
const parsed = computed(() => HrPayrollRunCreateSchema.safeParse({ month: normalizeDigits(month.value).trim() }))

// A month that already has a run is refused on the month field; anything else is a general error.
const serverMonth = computed(() => failure.value instanceof ApiError && failure.value.field === 'month' ? failure.value : null)
const monthError = computed(() => {
  if (attempted.value && !parsed.value.success) return t('hrPayroll.runs.monthRequired')
  if (!serverMonth.value) return undefined
  return serverMonth.value.code === 'duplicate' ? t('hrPayroll.errors.duplicate') : t('hrPayroll.runs.monthRequired')
})
const formError = computed(() => failure.value && !serverMonth.value
  ? saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
  : undefined)

const monthLabel = computed(() => parsed.value.success ? formatPayrollMonth(parsed.value.data.month, locale.value) : '')

function submit() {
  if (!hydrated.value || isPending.value) return
  attempted.value = true
  failure.value = null
  confirming.value = parsed.value.success
}
async function confirmCreate() {
  if (!hydrated.value || isPending.value || !parsed.value.success) return
  confirming.value = false
  try {
    const run = await createRun(parsed.value.data)
    saved.value = true
    await nextTick()
    emit('saved', run)
  } catch (error) { failure.value = error }
}
</script>

<template>
  <UForm novalidate :state="{ month }" class="liwan-form" method="post" data-testid="hr-payroll-run-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="formError" data-testid="hr-payroll-run-error" />
    <SharedInlineConfirm
      v-if="confirming"
      color="primary"
      :title="t('hrPayroll.runs.confirmTitle', { month: monthLabel })"
      :description="t('hrPayroll.runs.confirmHint')"
      :confirm-label="t('hrPayroll.runs.create')"
      :pending="isPending"
      @confirm="confirmCreate"
      @cancel="confirming = false"
    />
    <SharedFormSection panel :title="t('hrPayroll.runs.formTitle')" :description="t('hrPayroll.runs.formHint')">
      <UFormField :label="t('hrPayroll.runs.month')" name="hr-payroll-month" required :error="monthError">
        <UInput id="hr-payroll-month" v-model="month" type="month" class="w-full" :disabled="!hydrated || isPending" @update:model-value="confirming = false" data-testid="hr-payroll-month" />
      </UFormField>
    </SharedFormSection>
    <SharedFormActions>
      <span class="text-xs text-muted">{{ t('hrPayroll.runs.requiredHint') }}</span>
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
        <UButton type="submit" color="primary" :disabled="!hydrated || isPending" :loading="isPending" :label="t('hrPayroll.runs.create')" data-testid="hr-payroll-run-submit" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
