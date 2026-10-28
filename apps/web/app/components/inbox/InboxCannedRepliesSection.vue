<script setup lang="ts">
import { InboxCannedReplyWriteSchema, type InboxCannedReply } from '@webvue/contracts'
import { useInboxCannedReplies } from '@/composables/inbox/useInbox'
import { useDeleteInboxCannedReply, useSaveInboxCannedReply } from '@/composables/inbox/useInboxSettings'

// Canned replies are ready answers an agent inserts by typing "/" and the start of the shortcut in the composer.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxCannedReplies()
const { mutate: save, isPending: saving } = useSaveInboxCannedReply()
const { mutate: remove, isPending: removing } = useDeleteInboxCannedReply()
const items = computed(() => data.value?.items ?? [])
const editing = ref<number | 0 | null>(null)
const shortcut = ref('')
const body = ref('')
const attempted = ref(false)
const deleting = ref<InboxCannedReply | null>(null)
const locked = computed(() => !hydrated.value || saving.value || removing.value)
const draft = computed(() => ({ shortcut: shortcut.value.trim().replace(/^\//, ''), body: body.value.trim() }))
const valid = computed(() => InboxCannedReplyWriteSchema.safeParse(draft.value).success)

function edit(reply?: InboxCannedReply) {
  editing.value = reply?.id ?? 0
  shortcut.value = reply?.shortcut ?? ''
  body.value = reply?.body ?? ''
  attempted.value = false
  deleting.value = null
}
function submit() {
  attempted.value = true
  if (locked.value || !valid.value) return
  save({ id: editing.value || undefined, body: draft.value }, {
    onSuccess: () => { editing.value = null },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
function confirmDelete() {
  if (!deleting.value) return
  remove(deleting.value.id, {
    onSuccess: () => { deleting.value = null },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection id="canned-replies" variant="panel" class="webvue-settings-anchor" :title="t('inbox.settings.canned.title')" :description="t('inbox.settings.canned.hint')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="locked" :label="t('inbox.settings.canned.add')" data-testid="inbox-canned-add" @click="edit()" />
    </template>
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <div v-else class="flex flex-col gap-3">
      <form v-if="editing !== null" class="flex flex-col gap-3 rounded-control bg-elevated/50 p-3" novalidate @submit.prevent="submit">
        <UFormField :label="t('inbox.settings.canned.shortcut')" :description="t('inbox.settings.canned.shortcutHint')" required :error="attempted && !draft.shortcut ? t('inbox.settings.requiredName') : undefined">
          <UInput v-model="shortcut" class="w-full" maxlength="32" dir="auto" :disabled="locked" data-testid="inbox-canned-shortcut" />
        </UFormField>
        <UFormField :label="t('inbox.settings.canned.body')" required :error="attempted && !draft.body ? t('inbox.settings.canned.requiredBody') : undefined">
          <UTextarea v-model="body" class="w-full" :rows="3" maxlength="4096" :disabled="locked" data-testid="inbox-canned-body" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :disabled="locked" :label="t('app.cancel')" @click="editing = null" />
          <UButton type="submit" :disabled="locked" :loading="saving" :label="t('app.save')" data-testid="inbox-canned-save" />
        </div>
      </form>
      <SharedInlineConfirm
        v-if="deleting"
        :title="t('inbox.settings.canned.deleteTitle', { name: deleting.shortcut })"
        :description="t('inbox.settings.canned.deleteDescription')"
        :confirm-label="t('inbox.settings.delete')"
        :pending="removing"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
      <p v-if="!items.length && editing === null" class="text-sm text-muted">{{ t('inbox.settings.canned.empty') }}</p>
      <ul v-else class="divide-y divide-default">
        <li v-for="reply in items" :key="reply.id" class="flex flex-wrap items-center justify-between gap-2 py-2" :data-testid="`inbox-canned-${reply.id}`">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-highlighted" dir="auto">/{{ reply.shortcut.replace(/^\//, '') }}</p>
            <p class="truncate text-xs text-muted">{{ reply.body }}</p>
          </div>
          <div class="flex gap-1">
            <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-pencil" :disabled="locked" :aria-label="t('inbox.settings.edit', { name: reply.shortcut })" @click="edit(reply)" />
            <UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :disabled="locked" :aria-label="t('inbox.settings.remove', { name: reply.shortcut })" @click="deleting = reply; editing = null" />
          </div>
        </li>
      </ul>
    </div>
  </SharedRecordSection>
</template>
