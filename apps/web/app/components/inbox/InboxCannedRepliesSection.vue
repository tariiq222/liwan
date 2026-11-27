<script setup lang="ts">
import type { InboxCannedReply } from '@liwan/contracts'
import type { RowAction } from '@liwan/ui/app/components/shared/data/RowActions.vue'
import { returnToQuery } from '@liwan/ui/app/utils/safeReturnTo'
import { useInboxCannedReplies } from '@/composables/inbox/useInbox'
import { useDeleteInboxCannedReply } from '@/composables/inbox/useInboxSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Canned replies are ready answers an agent inserts by typing "/" and the start of the shortcut in the composer.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('inbox.settings.manage'))
const { data, isLoading, error, refetch } = useInboxCannedReplies()
const { mutateAsync: remove, isPending: removing } = useDeleteInboxCannedReply()
const items = computed(() => data.value?.items ?? [])
const deleting = ref<InboxCannedReply | null>(null)
const deleteError = ref('')
const locked = computed(() => !hydrated.value || removing.value)

const rowActions = (reply: InboxCannedReply): RowAction[] => canManage.value
  ? [
      {
        label: t('app.edit'),
        icon: 'i-lucide-pencil',
        to: { path: `/settings/apps/inbox/canned-replies/${reply.id}/edit`, query: returnToQuery(route.fullPath) },
      },
      {
        label: t('inbox.settings.delete'),
        icon: 'i-lucide-trash-2',
        destructive: true,
        onSelect: () => {
          deleteError.value = ''
          deleting.value = reply
        },
      },
    ]
  : []

async function confirmDelete() {
  if (!deleting.value || !canManage.value || removing.value) return
  deleteError.value = ''
  try {
    await remove(deleting.value.id)
    deleting.value = null
  } catch (e) {
    deleteError.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  }
}
</script>

<template>
  <SharedRecordSection id="canned-replies" variant="panel" class="liwan-settings-anchor" :title="t('inbox.settings.canned.title')" :description="t('inbox.settings.canned.hint')">
    <template #actions>
      <UButton
        v-if="canManage"
        :to="{ path: '/settings/apps/inbox/canned-replies/new', query: returnToQuery(route.fullPath) }"
        icon="i-lucide-plus"
        :disabled="!hydrated"
        :label="t('inbox.settings.canned.add')"
        data-testid="inbox-canned-add"
      />
      <UBadge v-else color="neutral" variant="subtle" :label="t('app.viewOnly')" />
    </template>
    <SharedPageState :loading="isLoading" :error="data ? null : error" :empty="false" @retry="refetch()">
      <div class="flex flex-col gap-3">
        <UAlert v-if="deleteError" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="deleteError" />
        <SharedInlineConfirm
          v-if="deleting"
          :title="t('inbox.settings.canned.deleteTitle', { name: deleting.shortcut })"
          :description="t('inbox.settings.canned.deleteDescription')"
          :confirm-label="t('inbox.settings.delete')"
          :pending="removing"
          @confirm="confirmDelete"
          @cancel="deleting = null"
        />
        <p v-if="!items.length" class="text-sm text-muted">{{ t('inbox.settings.canned.empty') }}</p>
        <ul v-else class="divide-y divide-default">
          <li v-for="reply in items" :key="reply.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`inbox-canned-${reply.id}`">
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-highlighted" dir="auto">/{{ reply.shortcut.replace(/^\//, '') }}</p>
              <p class="truncate text-xs text-muted">{{ reply.body }}</p>
            </div>
            <SharedRowActions v-if="rowActions(reply).length" :actions="rowActions(reply)" :label="t('inbox.settings.canned.actionsNamed', { name: reply.shortcut })" :disabled="locked" />
          </li>
        </ul>
      </div>
    </SharedPageState>
  </SharedRecordSection>
</template>
