<script setup lang="ts">
import { INBOX_COMMERCE_LIMITS } from '@webvue/contracts'
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
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
function toggle(body: { cart_enabled: boolean } | { catalog_visible: boolean } | { paid_notice_enabled: boolean }) {
  patch({ channelId: props.channelId, body }, { onError: fail })
}
// The paid-notice text is edited locally and saved with its own button (a keystroke is not a request).
const noticeText = ref('')
watch(() => commerce.data.value?.paid_notice_text, (value) => { noticeText.value = value ?? '' }, { immediate: true })
const noticeDirty = computed(() => !!commerce.data.value && noticeText.value.trim() !== commerce.data.value.paid_notice_text)
const noticeValid = computed(() => !!noticeText.value.trim() && noticeText.value.length <= INBOX_COMMERCE_LIMITS.body)
function saveNotice() {
  if (off.value || !noticeDirty.value || !noticeValid.value) return
  patch({ channelId: props.channelId, body: { paid_notice_text: noticeText.value.trim() } }, { onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }), onError: fail })
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
        <label class="flex items-start gap-3 text-sm">
          <USwitch :model-value="commerce.data.value.paid_notice_enabled" class="mt-0.5" :disabled="off" :aria-label="t('inbox.catalog.channelBlock.paidNotice')" data-testid="inbox-channel-paid-notice" @update:model-value="toggle({ paid_notice_enabled: $event })" />
          <span><span class="block font-medium text-highlighted">{{ t('inbox.catalog.channelBlock.paidNotice') }}</span><span class="block text-xs text-muted">{{ t('inbox.catalog.channelBlock.paidNoticeHint') }}</span></span>
        </label>
        <form class="flex flex-col gap-2" @submit.prevent="saveNotice">
          <UFormField :label="t('inbox.catalog.channelBlock.paidNoticeText')" :description="t('inbox.catalog.channelBlock.paidNoticeTextHint')" :hint="`${noticeText.length}/${INBOX_COMMERCE_LIMITS.body}`">
            <UTextarea v-model="noticeText" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="INBOX_COMMERCE_LIMITS.body" :disabled="off" data-testid="inbox-channel-paid-notice-text" />
          </UFormField>
          <div v-if="props.manage" class="flex justify-end">
            <UButton type="submit" :disabled="off || !noticeDirty || !noticeValid" :loading="isPending" :label="t('app.save')" data-testid="inbox-channel-paid-notice-save" />
          </div>
        </form>
      </template>
    </div>
  </SharedRecordSection>
</template>
