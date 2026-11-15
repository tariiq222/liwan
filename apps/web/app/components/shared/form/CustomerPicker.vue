<script setup lang="ts">
import type { CustomerPick } from '@liwan/contracts'
import { useCustomerPick } from '@/composables/customers/useCustomerPick'

// The one picker for choosing a customer of the customers service from /api/v1/customers/pick: a search box over the
// active customers, each shown with its name, whether it is a company and the last four digits of its phone. Tap a
// customer to pick it and tap it again to drop it. `selected` keeps the chosen customer visible while a search hides
// it. It cannot make a customer: a tenant with none yet is told that customers are added from the customers list, with
// a link to the new-customer page for a holder of `customers.manage`.
const props = defineProps<{
  modelValue: number | null
  selected?: { id: number; name: string } | null
  disabled?: boolean
  ariaLabel?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: number | null]; resolve: [customer: CustomerPick | null] }>()
const { t } = useI18n()
const { can } = useAccess()
const search = ref('')
// A locked picker asks for nothing: the pick list answers 403 to whoever may not pick.
const query = useCustomerPick(search, computed(() => !props.disabled))
const items = computed(() => query.data.value?.items ?? [])
const pickedOutside = computed(() => props.selected && props.selected.id === props.modelValue && !items.value.some(customer => customer.id === props.modelValue) ? props.selected : null)
</script>

<template>
  <SharedPickList
    :model-value="props.modelValue"
    :items="items"
    :loading="query.isLoading.value"
    :error="query.error.value"
    :disabled="props.disabled"
    test-id="customer-picker"
    :search-label="t('app.customerPicker.search')"
    :list-label="t('app.customerPicker.listLabel')"
    :empty-text="t('app.customerPicker.empty')"
    :aria-label="props.ariaLabel"
    :create-to="can('customers.manage') ? '/customers/new' : undefined"
    :create-label="t('app.customerPicker.create')"
    @update:model-value="emit('update:modelValue', $event)"
    @resolve="emit('resolve', $event)"
    @update:search="search = $event"
    @retry="query.refetch()"
  >
    <template #notice>
      <p v-if="pickedOutside" class="flex items-center gap-2 text-sm text-highlighted" data-testid="customer-picker-selected">
        <UIcon name="i-lucide-circle-check" class="size-4 text-primary" aria-hidden="true" />
        {{ t('app.customerPicker.selected', { name: pickedOutside.name }) }}
      </p>
    </template>
    <template #row="{ item: customer }">
      <UIcon :name="customer.is_company ? 'i-lucide-building-2' : 'i-lucide-user-round'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-medium text-highlighted">{{ customer.name }}</span>
        <span v-if="customer.phone_last4" class="block truncate text-xs text-muted">{{ t('app.customerPicker.phoneEnding') }} <bdi dir="ltr">{{ customer.phone_last4 }}</bdi></span>
      </span>
    </template>
  </SharedPickList>
</template>
