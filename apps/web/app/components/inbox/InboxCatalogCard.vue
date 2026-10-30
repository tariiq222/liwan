<script setup lang="ts">
import type { InboxCatalog } from '@liwan/contracts'
import { CATALOG_STATE_TONE } from '@/composables/inbox/inboxCommerce'
import { usePatchInboxChannelCommerce, useSyncInboxCatalog } from '@/composables/inbox/useInboxCatalog'

// One connected catalog (one per WhatsApp business account): its state, the item counts by sync status, the last sync,
// "sync now", and for each phone number of the account the two Meta switches (customers can use the cart; the catalog
// shows on the business profile). A switch changes Meta first, so a refusal leaves it where it was.
const props = defineProps<{ catalog: InboxCatalog; manage: boolean }>()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: sync, isPending: syncing } = useSyncInboxCatalog()
const { mutate: patch, isPending: patching } = usePatchInboxChannelCommerce()
const busy = computed(() => !hydrated.value || syncing.value || patching.value)
const lastSync = computed(() => (props.catalog.last_sync_at ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(props.catalog.last_sync_at)) : t('inbox.catalog.neverSynced')))
const counts = computed(() => (['items', 'synced', 'pending', 'error', 'rejected'] as const).map(key => ({ key, value: props.catalog.counts[key] })))
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
function runSync() {
  sync(props.catalog.id, { onSuccess: () => toast.add({ title: t('inbox.catalog.syncStarted'), color: 'success' }), onError: fail })
}
function toggle(channelId: number, body: { cart_enabled: boolean } | { catalog_visible: boolean }) {
  patch({ channelId, body }, { onError: fail })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="props.catalog.name || props.catalog.meta_catalog_id" :description="t('inbox.catalog.wabaLine', { id: props.catalog.business_account_id })" :data-testid="`inbox-catalog-${props.catalog.id}`">
    <template #actions>
      <SharedStatusBadge :tone="CATALOG_STATE_TONE[props.catalog.state]" :label="t(`inbox.catalog.states.${props.catalog.state}`)" data-testid="inbox-catalog-state" />
      <UButton v-if="props.manage" type="button" color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="syncing" :disabled="busy" :label="t('inbox.catalog.syncNow')" data-testid="inbox-catalog-sync" @click="runSync" />
      <UButton :to="`/settings/apps/inbox/catalog/${props.catalog.id}`" color="neutral" variant="outline" icon="i-lucide-package" :label="t('inbox.catalog.open')" :disabled="!hydrated" data-testid="inbox-catalog-open" />
    </template>
    <div class="flex flex-col gap-4">
      <UAlert v-if="props.catalog.last_error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="t('inbox.catalog.lastError')" :description="props.catalog.last_error" data-testid="inbox-catalog-error" />
      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <div v-for="count in counts" :key="count.key" class="flex flex-col">
          <dt class="text-xs text-muted">{{ t(`inbox.catalog.counts.${count.key}`) }}</dt>
          <dd class="text-lg font-semibold tabular-nums text-highlighted">{{ count.value }}</dd>
        </div>
      </dl>
      <p class="text-xs text-muted">{{ t('inbox.catalog.lastSync', { time: lastSync }) }}</p>
      <ul v-if="props.catalog.channels.length" class="flex flex-col divide-y divide-default" :aria-label="t('inbox.catalog.numbers')">
        <li v-for="channel in props.catalog.channels" :key="channel.id" class="flex flex-col gap-2 py-2">
          <p class="text-sm font-medium text-highlighted">{{ channel.name }}</p>
          <label class="flex items-center gap-3 text-sm">
            <USwitch :model-value="channel.cart_enabled ?? false" :disabled="busy || !props.manage || channel.cart_enabled === null" :aria-label="t('inbox.catalog.cartEnabled')" :data-testid="`inbox-catalog-cart-${channel.id}`" @update:model-value="toggle(channel.id, { cart_enabled: $event })" />{{ t('inbox.catalog.cartEnabled') }}
          </label>
          <label class="flex items-center gap-3 text-sm">
            <USwitch :model-value="channel.catalog_visible ?? false" :disabled="busy || !props.manage || channel.catalog_visible === null" :aria-label="t('inbox.catalog.catalogVisible')" :data-testid="`inbox-catalog-visible-${channel.id}`" @update:model-value="toggle(channel.id, { catalog_visible: $event })" />{{ t('inbox.catalog.catalogVisible') }}
          </label>
        </li>
      </ul>
    </div>
  </SharedRecordSection>
</template>
