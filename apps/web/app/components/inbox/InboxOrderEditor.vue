<script setup lang="ts">
import type { InboxOrder, InboxOrderCreate, InboxOrderPatch } from '@liwan/contracts'
import InboxProductPicker from '@/components/inbox/InboxProductPicker.vue'
import { COMMERCE_LIMITS } from '@/composables/inbox/inboxCommerce'
import { useInboxPickItems } from '@/composables/inbox/useInboxCatalog'
import { useCreateInboxOrder, usePatchInboxOrder } from '@/composables/inbox/useInboxOrders'

// Builds or changes a cart: quantities (1 to 99), removing a line, adding a catalog product. Without `order` it makes a
// new order for the customer; with one it replaces that cart's lines (a line left out is removed). A cart the customer
// sent is edited here, not in WhatsApp: WhatsApp carts cannot be changed once sent.
const props = defineProps<{ conversationId: number; order?: InboxOrder }>()
const emit = defineEmits<{ saved: [order: InboxOrder]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const limits = COMMERCE_LIMITS
interface Row { id?: number; itemId?: number; retailerId: string; name: string; quantity: number }
const rows = ref<Row[]>((props.order?.lines ?? []).map(line => ({ id: line.id, retailerId: line.product_retailer_id, name: line.name ?? line.product_retailer_id, quantity: line.quantity })))
const q = ref('')
const items = useInboxPickItems(() => ({ conversationId: props.conversationId }), q)
const { mutateAsync: create, isPending: creating } = useCreateInboxOrder(() => props.conversationId)
const { mutateAsync: patch, isPending: patching } = usePatchInboxOrder()
const pending = computed(() => creating.value || patching.value)
const picked = computed(() => rows.value.map(row => row.retailerId))
const valid = computed(() => rows.value.length > 0 && rows.value.length <= limits.orderLines && rows.value.every(row => Number.isInteger(row.quantity) && row.quantity >= 1 && row.quantity <= limits.cartQuantity))

function toggle(retailerId: string) {
  const index = rows.value.findIndex(row => row.retailerId === retailerId)
  if (index >= 0) {
    rows.value.splice(index, 1)
    return
  }
  const item = items.data.value?.items.find(candidate => candidate.product_retailer_id === retailerId)
  if (item) rows.value.push({ itemId: item.id, retailerId, name: item.name, quantity: 1 })
}

async function save() {
  if (!valid.value || pending.value || !hydrated.value) return
  try {
    const saved = props.order
      ? await patch({ id: props.order.id, body: { lines: rows.value.map(row => (row.id ? { id: row.id, quantity: row.quantity } : { catalog_item_id: row.itemId!, quantity: row.quantity })) } satisfies InboxOrderPatch })
      : await create({ lines: rows.value.map(row => ({ catalog_item_id: row.itemId!, quantity: row.quantity })) } satisfies InboxOrderCreate)
    emit('saved', saved)
  } catch (e) {
    toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
  }
}
</script>

<template>
  <SharedSubCard tone="tinted" class="flex flex-col gap-3" data-testid="inbox-order-editor">
    <ul v-if="rows.length" class="flex flex-col gap-2" :aria-label="t('inbox.orders.lines')">
      <li v-for="(row, index) in rows" :key="row.id ?? row.retailerId" class="flex items-center gap-2">
        <span class="min-w-0 flex-1 truncate text-sm">{{ row.name }}</span>
        <UInput v-model.number="row.quantity" type="number" :min="1" :max="limits.cartQuantity" class="w-20" :disabled="!hydrated" :aria-label="t('inbox.orders.quantityOf', { name: row.name })" :data-testid="`inbox-order-qty-${index}`" />
        <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('inbox.orders.removeLine', { name: row.name })" @click="rows.splice(index, 1)" />
      </li>
    </ul>
    <p v-else class="text-sm text-muted">{{ t('inbox.orders.noLines') }}</p>
    <p class="text-sm font-medium text-highlighted">{{ t('inbox.orders.addProducts') }}</p>
    <InboxProductPicker v-model:q="q" :items="items.data.value?.items ?? []" :picked="picked" :max="limits.orderLines" :loading="items.isPending.value" :error="items.error.value" @toggle="toggle" @retry="items.refetch()" />
    <div class="flex justify-end gap-2">
      <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="pending" @click="emit('cancel')" />
      <UButton type="button" :label="t('app.save')" :loading="pending" :disabled="!hydrated || !valid" data-testid="inbox-order-save" @click="save" />
    </div>
  </SharedSubCard>
</template>
