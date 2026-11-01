<script setup lang="ts">
import type { ProjectChange, ProjectChangeWrite } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useChangeCategories, useCreateProjectChange, useUpdateProjectChange } from '@/composables/useProjectChanges'

// Raising a change request and editing its draft. The server owns the number, the requester and the state.
const props = defineProps<{ projectId: number; item?: ProjectChange }>()
const emit = defineEmits<{ saved: [item: ProjectChange]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const categories = useChangeCategories()
const NO_CATEGORY = 'none'

const title = ref(props.item?.title ?? '')
const description = ref(props.item?.description ?? '')
const reason = ref(props.item?.reason ?? '')
const categoryId = ref<string>(props.item?.category ? String(props.item.category.id) : NO_CATEGORY)
const scheduleDays = ref<number | undefined>(props.item?.impact_schedule_days ?? 0)
const costInput = ref(props.item ? String(props.item.impact_cost) : '0')
const impactScope = ref(props.item?.impact_scope ?? '')

const categoryItems = computed(() => {
  const current = props.item?.category
  const options = categories.data.value?.items.map(category => ({ value: String(category.id), label: category.name })) ?? []
  if (current && !options.some(option => option.value === String(current.id))) options.unshift({ value: String(current.id), label: current.name })
  return [{ value: NO_CATEGORY, label: t('projects.changes.noCategory') }, ...options]
})
const currencySymbol = computed(() => props.item?.currency?.symbol ?? '')
const cost = computed(() => costInput.value.trim() === '' ? NaN : Number(costInput.value))
const costError = computed(() => attempted.value && !Number.isFinite(cost.value) ? t('projects.changes.costInvalid') : undefined)
const daysError = computed(() => attempted.value && !Number.isInteger(scheduleDays.value) ? t('projects.changes.daysInvalid') : undefined)
const titleError = computed(() => attempted.value && !title.value.trim() ? t('projects.changes.titleRequired') : undefined)

const snapshot = () => JSON.stringify([title.value, description.value, reason.value, categoryId.value, scheduleDays.value, costInput.value, impactScope.value])
const baseline = snapshot()
const submitted = ref(false)
const attempted = ref(false)
const error = ref<string | null>(null)
const dirty = computed(() => !submitted.value && snapshot() !== baseline)
const create = useCreateProjectChange()
const update = useUpdateProjectChange()
const pending = computed(() => create.isPending.value || update.isPending.value)

async function submit() {
  if (!hydrated.value || pending.value) return
  attempted.value = true
  error.value = null
  if (!title.value.trim() || !Number.isFinite(cost.value) || !Number.isInteger(scheduleDays.value)) return
  const body: ProjectChangeWrite = {
    title: title.value.trim(),
    description: description.value,
    reason: reason.value,
    category_id: categoryId.value === NO_CATEGORY ? null : Number(categoryId.value),
    impact_schedule_days: scheduleDays.value,
    impact_cost: cost.value,
    impact_scope: impactScope.value,
  }
  try {
    const item = props.item
      ? await update.mutateAsync({ projectId: props.projectId, id: props.item.id, expected: props.item.updated_at, body })
      : await create.mutateAsync({ projectId: props.projectId, body })
    submitted.value = true
    toast.add({ title: t(props.item ? 'projects.changes.toast.updated' : 'projects.changes.toast.created'), color: 'success' })
    await nextTick()
    emit('saved', item)
  }
  catch (e) {
    error.value = e instanceof ApiError && e.code === 'stale_write' ? t('projects.changes.stale') : e instanceof ApiError ? e.message : t('errors.generic')
  }
}
</script>

<template>
  <form novalidate class="liwan-page-stack" data-testid="change-form" @submit.prevent="submit">
    <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('projects.changes.form.detailsTitle')" :description="t('projects.changes.form.detailsDescription')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('projects.changes.fields.title')" required :error="titleError">
          <UInput id="change-title" v-model="title" class="w-full" required :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.changes.fields.category')">
          <USelect id="change-category" v-model="categoryId" :items="categoryItems" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.changes.fields.description')">
          <UTextarea id="change-description" v-model="description" class="w-full" :rows="4" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.changes.fields.reason')">
          <UTextarea id="change-reason" v-model="reason" class="w-full" :rows="3" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormSection panel :title="t('projects.changes.form.impactTitle')" :description="t('projects.changes.form.impactDescription')">
      <div class="grid gap-(--liwan-gap-card)">
        <UFormField :label="t('projects.changes.fields.scheduleDays')" :help="t('projects.changes.form.scheduleHelp')" :error="daysError">
          <UInputNumber id="change-days" v-model="scheduleDays" class="w-full" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="currencySymbol ? `${t('projects.changes.fields.cost')} (${currencySymbol})` : t('projects.changes.fields.cost')" :help="t('projects.changes.form.costHelp')" :error="costError">
          <UInput id="change-cost" v-model="costInput" class="w-full" inputmode="decimal" dir="ltr" :disabled="!hydrated || pending" />
        </UFormField>
        <UFormField :label="t('projects.changes.fields.impactScope')">
          <UTextarea id="change-impact-scope" v-model="impactScope" class="w-full" :rows="3" :disabled="!hydrated || pending" />
        </UFormField>
      </div>
    </SharedFormSection>

    <SharedFormActions>
      <p class="me-auto text-xs text-muted">{{ t('projects.requiredHint') }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="!hydrated || pending" @click="emit('cancel')">{{ t('app.cancel') }}</UButton>
        <UButton type="submit" data-testid="change-form-save" :disabled="!hydrated || pending" :loading="pending">{{ t(item ? 'app.save' : 'projects.changes.create') }}</UButton>
      </div>
    </SharedFormActions>
  </form>
</template>
