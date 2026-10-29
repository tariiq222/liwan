<script setup lang="ts">
import { useSyncInboxTemplates, useInboxChannelRef } from '@/composables/inbox/useInboxSettings'

// The templates of one channel: the list with the review state Meta gave each, the sync with Meta, and a link to create one.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.id)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const channel = useInboxChannelRef(id)
const { mutate: sync, isPending: syncing } = useSyncInboxTemplates(() => id.value ?? 0)
// The channel page is channel administration: only whoever holds that capability gets a way back to it.
const backTo = computed(() => can('inbox.channels.manage') ? `/settings/apps/inbox/channels/${id.value}` : undefined)
const readable = computed(() => can('inbox.channels.manage') || can('inbox.templates.manage'))
const manage = computed(() => can('inbox.templates.manage'))
function runSync() {
  sync(undefined, {
    onSuccess: () => toast.add({ title: t('inbox.settings.channels.synced'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordPage
    :title="t('inbox.templates.pageTitle', { name: channel.data.value?.name ?? '' })"
    :back-to="backTo"
    :back-label="backTo ? channel.data.value?.name ?? t('inbox.settings.channels.title') : undefined"
    :loading="id !== null && channel.isPending.value"
    :error="id === null ? { status: 404 } : channel.error.value"
    @retry="hydrated && channel.refetch()"
  >
    <template v-if="id && readable && manage" #actions>
      <UButton color="neutral" variant="outline" icon="i-lucide-refresh-cw" :loading="syncing" :disabled="!hydrated || syncing" :label="t('inbox.settings.channels.syncTemplates')" data-testid="inbox-templates-sync" @click="runSync" />
    </template>
    <InboxTemplateList v-if="id && readable" :channel-id="id" />
    <SharedForbiddenState v-else-if="id" />
  </SharedRecordPage>
</template>
