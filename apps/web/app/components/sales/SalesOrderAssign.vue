<script setup lang="ts">
import type { SalesOrder } from '@liwan/contracts'
import { saveErrorMessage } from '@/utils/formFeedback'
import { salesRefusalKey } from '@/composables/sales/salesErrors'
import { useAssignSalesOrder } from '@/composables/sales/useSalesOrders'

// Changes the salesperson of a staff document in any state, for a holder of the assign right (`order.actions.assign`).
// The choices come from /api/v1/sales/salespeople through the shared person picker; the save stays pending until the server answers.
const props = defineProps<{ order: SalesOrder }>()
const emit = defineEmits<{ done: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const chosen = ref<number | null>(props.order.salesperson?.id ?? null)
const failure = ref<unknown>(null)
const message = computed(() => {
  const key = salesRefusalKey(failure.value)
  return key ? t(key) : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
})
const { mutateAsync: assign, isPending } = useAssignSalesOrder()
const unchanged = computed(() => !chosen.value || chosen.value === props.order.salesperson?.id)

async function save() {
  if (!hydrated.value || isPending.value || unchanged.value) return
  failure.value = null
  try {
    await assign({ id: props.order.id, salespersonId: chosen.value! })
    emit('done')
  } catch (error) { failure.value = error }
}
</script>

<template>
  <SharedSubCard data-testid="sales-assign">
    <div class="flex flex-wrap items-end gap-2">
      <UFormField :label="t('sales.assign.label')" class="min-w-56 flex-1">
        <SharedPersonPicker v-model="chosen" value-key="user_id" endpoint="/api/v1/sales/salespeople" :known="props.order.salesperson ? [props.order.salesperson] : []" :placeholder="t('sales.form.salespersonPlaceholder')" :disabled="isPending" data-testid="sales-assign-select" />
      </UFormField>
      <UButton color="primary" :label="t('sales.assign.save')" :loading="isPending" :disabled="!hydrated || unchanged" data-testid="sales-assign-save" @click="save" />
      <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="isPending" @click="emit('done')" />
    </div>
    <p v-if="failure" role="alert" class="mt-2 text-sm text-error">{{ message }}</p>
  </SharedSubCard>
</template>
