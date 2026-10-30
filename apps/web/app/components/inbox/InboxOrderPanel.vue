<script setup lang="ts">
import InboxOrderCard from '@/components/inbox/InboxOrderCard.vue'
import InboxOrderEditor from '@/components/inbox/InboxOrderEditor.vue'
import { useInboxConversationOrders } from '@/composables/inbox/useInboxOrders'

// The side panel /inbox/<id>/orders: this conversation's carts and orders with their payment status, the pay-link and
// cancel actions, and a button for an agent to build an order for the customer.
const props = defineProps<{ conversationId: number; windowOpen: boolean }>()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const query = useInboxConversationOrders(() => props.conversationId)
const items = computed(() => query.data.value?.items ?? [])
const creating = ref(false)
</script>

<template>
  <div class="flex flex-col gap-3 p-3" data-testid="inbox-order-panel">
    <UButton v-if="can('inbox.orders.manage')" type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.orders.create')" :aria-pressed="creating" :disabled="!hydrated" data-testid="inbox-order-new" @click="creating = !creating" />
    <InboxOrderEditor v-if="creating" :conversation-id="props.conversationId" @saved="creating = false" @cancel="creating = false" />
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <p v-else-if="!items.length" class="text-sm text-muted" data-testid="inbox-orders-empty">{{ t('inbox.orders.panelEmpty') }}</p>
    <InboxOrderCard v-for="order in items" v-else :key="order.id" :order="order" :window-open="props.windowOpen" />
  </div>
</template>
