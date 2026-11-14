<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
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
const hydrated = useHydrated()
const { can } = useAccess()
const q = ref('')
const search = refDebounced(q, 250)
// A locked picker asks for nothing: the pick list answers 403 to whoever may not pick.
const query = useCustomerPick(search, computed(() => !props.disabled))
const items = computed(() => query.data.value?.items ?? [])
const off = computed(() => props.disabled || !hydrated.value)
const pickedOutside = computed(() => props.selected && props.selected.id === props.modelValue && !items.value.some(customer => customer.id === props.modelValue) ? props.selected : null)

function toggle(customer: CustomerPick) {
  const picked = props.modelValue === customer.id
  emit('update:modelValue', picked ? null : customer.id)
  emit('resolve', picked ? null : customer)
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="customer-picker">
    <UInput v-model="q" class="w-full" icon="i-lucide-search" :placeholder="t('app.customerPicker.search')" :aria-label="props.ariaLabel ?? t('app.customerPicker.search')" :disabled="off" data-testid="customer-picker-search" @keydown.enter.prevent />
    <p v-if="pickedOutside" class="flex items-center gap-2 text-sm text-highlighted" data-testid="customer-picker-selected">
      <UIcon name="i-lucide-circle-check" class="size-4 text-primary" aria-hidden="true" />
      {{ t('app.customerPicker.selected', { name: pickedOutside.name }) }}
    </p>
    <SharedLoadingSkeleton v-if="query.isLoading.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <p v-else-if="!items.length" class="text-sm text-muted" data-testid="customer-picker-empty">
      {{ q.trim() ? t('app.noResults') : t('app.customerPicker.empty') }}
      <NuxtLink v-if="!q.trim() && can('customers.manage')" to="/customers/new" class="font-medium text-primary hover:underline" data-testid="customer-picker-create">{{ t('app.customerPicker.create') }}</NuxtLink>
    </p>
    <ul v-else class="flex max-h-72 flex-col divide-y divide-default overflow-y-auto rounded-control ring ring-default" :aria-label="t('app.customerPicker.listLabel')">
      <li v-for="customer in items" :key="customer.id">
        <button
          type="button"
          class="flex w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
          :class="{ 'bg-(--brand-soft)': props.modelValue === customer.id }"
          :aria-pressed="props.modelValue === customer.id"
          :disabled="off"
          :data-testid="`customer-picker-option-${customer.id}`"
          @click="toggle(customer)"
        >
          <UIcon :name="customer.is_company ? 'i-lucide-building-2' : 'i-lucide-user-round'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-highlighted">{{ customer.name }}</span>
            <span v-if="customer.phone_last4" class="block truncate text-xs text-muted">{{ t('app.customerPicker.phoneEnding') }} <bdi dir="ltr">{{ customer.phone_last4 }}</bdi></span>
          </span>
          <UIcon :name="props.modelValue === customer.id ? 'i-lucide-circle-check' : 'i-lucide-circle'" class="size-5 shrink-0" :class="props.modelValue === customer.id ? 'text-primary' : 'text-muted'" aria-hidden="true" />
        </button>
      </li>
    </ul>
  </div>
</template>
