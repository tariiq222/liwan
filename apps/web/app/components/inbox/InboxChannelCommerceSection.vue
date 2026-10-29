<script setup lang="ts">
import { useInboxChannelCommerce, usePatchInboxChannelCommerce } from '@/composables/inbox/useInboxCatalog'

// A channel's commerce block: the catalog its WhatsApp account uses (a link to the catalog page, or a link to connect
// one) and the two Meta switches of this number. A switch changes Meta first; a refusal leaves it where it was.
const props = defineProps<{ channelId: number; manage: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const commerce = useInboxChannelCommerce(() => props.channelId)
const { mutate: patch, isPending } = usePatchInboxChannelCommerce()
const off = computed(() => !hydrated.value || isPending.value || !props.manage)
function toggle(body: { cart_enabled: boolean } | { catalog_visible: boolean }) {
  patch({ channelId: props.channelId, body }, { onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }) })
}
</script>

<template>
  <SharedRecordSection id="commerce" variant="panel" :title="t('inbox.catalog.channelBlock.title')" :description="t('inbox.catalog.channelBlock.hint')">
    <SharedLoadingSkeleton v-if="commerce.isPending.value" />
    <SharedPageState v-else-if="commerce.error.value" :error="commerce.error.value" @retry="commerce.refetch()" />
    <div v-else-if="commerce.data.value" class="flex flex-col gap-4">
      <p v-if="commerce.data.value.catalog" class="text-sm">
        {{ t('inbox.catalog.channelBlock.catalog') }}:
        <NuxtLink :to="`/settings/apps/inbox/catalog/${commerce.data.value.catalog.id}`" class="text-brand-link underline" data-testid="inbox-channel-catalog-link">{{ commerce.data.value.catalog.name }}</NuxtLink>
      </p>
      <template v-else>
        <p class="text-sm text-muted" data-testid="inbox-channel-no-catalog">{{ t('inbox.catalog.channelBlock.none') }}</p>
        <UButton v-if="props.manage" to="/settings/apps/inbox/catalog/new" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.catalog.connect.title')" :disabled="!hydrated" />
      </template>
      <template v-if="commerce.data.value.catalog">
        <label class="flex items-center gap-3 text-sm">
          <USwitch :model-value="commerce.data.value.cart_enabled ?? false" :disabled="off" :aria-label="t('inbox.catalog.cartEnabled')" data-testid="inbox-channel-cart" @update:model-value="toggle({ cart_enabled: $event })" />{{ t('inbox.catalog.cartEnabled') }}
        </label>
        <label class="flex items-center gap-3 text-sm">
          <USwitch :model-value="commerce.data.value.catalog_visible ?? false" :disabled="off" :aria-label="t('inbox.catalog.catalogVisible')" data-testid="inbox-channel-visible" @update:model-value="toggle({ catalog_visible: $event })" />{{ t('inbox.catalog.catalogVisible') }}
        </label>
      </template>
    </div>
  </SharedRecordSection>
</template>
