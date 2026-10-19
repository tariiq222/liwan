<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HrActivityPlan, HrPlanStepInput } from '@webvue/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { ApiError } from '@/composables/useApi'
import { useHrDepartments } from '@/composables/useHrDepartments'
import PersonPicker from '@/components/shared/form/PersonPicker.vue'
import {
  useCreateHrActivityPlan,
  usePatchHrActivityPlan,
  type HrLifecycleArea,
} from '@/composables/useHrOnboarding'

// The create/edit surface of one lifecycle plan: the plan fields plus its steps, which
// replace the plan's templates on save.
const props = defineProps<{
  area: HrLifecycleArea
  namespace: string
  plan?: HrActivityPlan | null
  backTo: RouteLocationRaw
}>()
const emit = defineEmits<{ saved: [plan: HrActivityPlan] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const formError = ref<unknown>(null)
const errorMessage = computed(() => formError.value
  ? saveErrorMessage(formError.value, t(`${props.namespace}.form.saveError`), t('errors.saveUncertain'))
  : undefined)
const nameError = ref<string>()
const stepsError = ref<string>()
const canManage = computed(() => can(`hr.${props.area}.manage`))
const departments = useHrDepartments()
const departmentOptions = computed(() => [
  { value: 'none', label: t(`${props.namespace}.form.anyDepartment`) },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
])
const responsibleOptions = computed(() => [
  { value: 'manager', label: t(`${props.namespace}.form.typeManager`) },
  { value: 'coach', label: t(`${props.namespace}.form.typeCoach`) },
  { value: 'employee', label: t(`${props.namespace}.form.typeEmployee`) },
  { value: 'other', label: t(`${props.namespace}.form.typeOther`) },
])
const unitOptions = computed(() => [
  { value: 'days', label: t(`${props.namespace}.form.delayDays`) },
  { value: 'weeks', label: t(`${props.namespace}.form.delayWeeks`) },
  { value: 'months', label: t(`${props.namespace}.form.delayMonths`) },
])
const delayFromOptions = computed(() => [
  { value: 'before_plan_date', label: t(`${props.namespace}.form.beforePlanDate`) },
  { value: 'after_plan_date', label: t(`${props.namespace}.form.afterPlanDate`) },
])
const name = ref('')
const departmentId = ref<number | null>(null)
const active = ref(true)
const steps = ref<HrPlanStepInput[]>([])
const savedState = ref('')
const { mutateAsync: create, isPending: creating } = useCreateHrActivityPlan(props.area)
const { mutateAsync: update, isPending: updating } = usePatchHrActivityPlan(props.area)
const pending = computed(() => creating.value || updating.value)

function inputFrom(plan: HrActivityPlan): HrPlanStepInput[] {
  return plan.steps.map(step => ({
    summary: step.summary,
    responsible_type: step.responsible_type,
    responsible_user_id: step.responsible?.id ?? null,
    delay_count: step.delay_count,
    delay_unit: step.delay_unit,
    delay_from: step.delay_from,
  }))
}
function emptyStep(): HrPlanStepInput {
  return {
    summary: '', responsible_type: 'manager', responsible_user_id: null,
    delay_count: 0, delay_unit: 'days', delay_from: 'before_plan_date',
  }
}
function state() {
  return JSON.stringify([name.value, departmentId.value, active.value, steps.value])
}
const dirty = computed(() => savedState.value !== state())

watch(() => props.plan, (plan) => {
  name.value = plan?.name ?? ''
  departmentId.value = plan?.department?.id ?? null
  active.value = plan?.active ?? true
  steps.value = plan ? inputFrom(plan) : [emptyStep()]
  savedState.value = state()
}, { immediate: true })

function fieldError(field: string) {
  if (field === 'name' && nameError.value) return nameError.value
  if (field === 'steps' && stepsError.value) return stepsError.value
  return formError.value instanceof ApiError && formError.value.field === field ? formError.value.message : undefined
}
function addStep() { steps.value = [...steps.value, emptyStep()] }
function removeStep(index: number) { steps.value = steps.value.filter((_, position) => position !== index) }

let submitting = false
async function submit() {
  if (!canManage.value || !hydrated.value || pending.value || submitting) return
  nameError.value = undefined
  stepsError.value = undefined
  if (!name.value.trim()) {
    nameError.value = t(`${props.namespace}.form.name`)
    await nextTick()
    document.getElementById('hr-lifecycle-plan-name')?.focus()
    return
  }
  if (!steps.value.length) {
    stepsError.value = t(`${props.namespace}.form.stepsRequired`)
    return
  }
  submitting = true
  const payload = {
    name: name.value.trim(),
    department_id: departmentId.value,
    steps: steps.value.map(step => ({ ...step, responsible_user_id: step.responsible_type === 'other' ? step.responsible_user_id : null })),
  }
  try {
    const plan = props.plan
      ? await update({ id: props.plan.id, patch: { ...payload, active: active.value } })
      : await create(payload)
    savedState.value = state()
    formError.value = null
    emit('saved', plan)
  } catch (error) {
    formError.value = error
  } finally { submitting = false }
}
</script>

<template>
  <SharedUnsavedChanges :dirty="dirty" />
  <UForm :state="{ name, departmentId, active, steps }" class="webvue-form" method="post" :loading-auto="false" novalidate @submit="submit">
    <UAlert v-if="formError" role="alert" color="error" variant="subtle" :title="t(`${namespace}.form.saveError`)" :description="errorMessage" />
    <SharedFormSection panel :title="t(`${namespace}.plans.title`)">
      <div class="webvue-form-grid">
        <UFormField :label="t(`${namespace}.form.name`)" name="hr-lifecycle-plan-name" required :error="fieldError('name')">
          <UInput id="hr-lifecycle-plan-name" v-model="name" class="w-full" :placeholder="t(`${namespace}.form.namePlaceholder`)" :disabled="!canManage || !hydrated || pending" required />
        </UFormField>
        <UFormField :label="t(`${namespace}.form.department`)" name="hr-lifecycle-plan-department" :error="fieldError('department_id')">
          <USelect
            id="hr-lifecycle-plan-department"
            class="w-full"
            :model-value="departmentId ? String(departmentId) : 'none'"
            :items="departmentOptions"
            :disabled="!canManage || !hydrated || pending"
            @update:model-value="departmentId = !$event || $event === 'none' ? null : Number($event)"
          />
        </UFormField>
        <UFormField v-if="plan" :label="t(`${namespace}.form.active`)" name="hr-lifecycle-plan-active">
          <UCheckbox v-model="active" :disabled="!canManage || !hydrated || pending" :label="t(`${namespace}.form.active`)" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t(`${namespace}.form.steps`)">
      <div class="grid gap-4">
        <UAlert v-if="stepsError" role="alert" color="error" variant="subtle" :title="stepsError" />
        <div v-for="(step, index) in steps" :key="index" class="grid gap-3 border-default border-t pt-4 first:border-t-0 first:pt-0">
          <div class="webvue-form-grid">
            <UFormField :label="t(`${namespace}.form.stepSummary`)" :name="`step-${index}-summary`" required>
              <UInput v-model="step.summary" class="w-full" :disabled="!canManage || !hydrated || pending" required />
            </UFormField>
            <UFormField :label="t(`${namespace}.form.responsibleType`)" :name="`step-${index}-responsible`">
              <USelect
                class="w-full"
                :model-value="step.responsible_type"
                :items="responsibleOptions"
                :disabled="!canManage || !hydrated || pending"
                @update:model-value="step.responsible_type = String($event) as HrPlanStepInput['responsible_type']"
              />
            </UFormField>
            <UFormField v-if="step.responsible_type === 'other'" :label="t(`${namespace}.form.responsibleUser`)" :name="`step-${index}-user`" required>
              <PersonPicker v-model="step.responsible_user_id" value-key="id" :placeholder="t(`${namespace}.form.responsibleUser`)" />
            </UFormField>
            <UFormField :label="t(`${namespace}.form.delayCount`)" :name="`step-${index}-delay`">
              <UInput v-model.number="step.delay_count" type="number" min="0" class="w-full" :disabled="!canManage || !hydrated || pending" />
            </UFormField>
            <UFormField :label="t(`${namespace}.form.delayUnit`)" :name="`step-${index}-unit`">
              <USelect
                class="w-full"
                :model-value="step.delay_unit"
                :items="unitOptions"
                :disabled="!canManage || !hydrated || pending"
                @update:model-value="step.delay_unit = String($event) as HrPlanStepInput['delay_unit']"
              />
            </UFormField>
            <UFormField :label="t(`${namespace}.form.delayFrom`)" :name="`step-${index}-from`">
              <USelect
                class="w-full"
                :model-value="step.delay_from"
                :items="delayFromOptions"
                :disabled="!canManage || !hydrated || pending"
                @update:model-value="step.delay_from = String($event) as HrPlanStepInput['delay_from']"
              />
            </UFormField>
          </div>
          <div class="flex justify-end">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-trash-2"
              :disabled="!canManage || !hydrated || pending || steps.length === 1"
              :label="t(`${namespace}.form.removeStep`)"
              @click="removeStep(index)"
            />
          </div>
        </div>
        <div>
          <UButton type="button" color="neutral" variant="outline" size="sm" icon="i-lucide-plus" :disabled="!canManage || !hydrated || pending" :label="t(`${namespace}.form.addStep`)" @click="addStep" />
        </div>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :label="t('app.cancel')" />
      <UButton type="submit" color="primary" :disabled="!canManage || !hydrated || pending" :loading="pending" :label="t(props.plan ? 'app.saveChanges' : 'app.create')" />
    </SharedFormActions>
  </UForm>
</template>
