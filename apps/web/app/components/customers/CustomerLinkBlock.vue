<script setup lang="ts">
import type { CustomerCandidate, CustomerLink, CustomerLinkRef } from '@liwan/contracts'
import CustomerConflictStep from '@/components/customers/CustomerConflictStep.vue'

// The customer a record (a CRM opportunity, an inbox contact) is linked to, or the action that links it. The action
// asks the server to make a customer from the record's own data; when customers already share the record's phone the
// caller passes their `candidates` and the user picks one of them or asks for a new customer, never a silent merge.
// The caller sends the request and owns what happens with the answer.
const props = defineProps<{
  customer: CustomerLinkRef | null
  /** The user may link this record: they hold the capability and the record is open. */
  canLink: boolean
  /** The user may open the customer's page. */
  canOpen?: boolean
  candidates?: CustomerCandidate[] | null
  pending?: boolean
  error?: string
}>()
const emit = defineEmits<{ link: [choice: CustomerLink]; dismiss: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
</script>

<template>
  <div class="grid gap-3 text-sm" data-testid="customer-link">
    <p v-if="props.customer" class="flex items-center gap-2" data-testid="customer-link-linked">
      <UIcon name="i-lucide-contact-round" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <NuxtLink v-if="props.canOpen" :to="`/customers/${props.customer.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline" :aria-label="t('customers.link.open', { name: props.customer.name })">{{ props.customer.name }}</NuxtLink>
      <span v-else class="min-w-0 truncate font-semibold">{{ props.customer.name }}</span>
    </p>
    <template v-else>
      <p class="text-muted" data-testid="customer-link-none">{{ t('customers.link.none') }}</p>
      <CustomerConflictStep
        v-if="props.candidates"
        :candidates="props.candidates"
        :pending="props.pending"
        :description="t('customers.link.conflictDescription')"
        :confirm-label="t('customers.link.conflictConfirm')"
        @open="emit('link', { customer_id: $event })"
        @create-new="emit('link', { create_new: true })"
        @cancel="emit('dismiss')"
      />
      <UButton v-else-if="props.canLink" class="justify-self-start" size="xs" color="neutral" variant="outline" icon="i-lucide-user-plus" :label="t('customers.link.action')" :loading="props.pending" :disabled="!hydrated || props.pending" data-testid="customer-link-action" @click="emit('link', {})" />
    </template>
    <UAlert v-if="props.error" role="alert" color="error" variant="subtle" :description="props.error" data-testid="customer-link-error" />
  </div>
</template>
