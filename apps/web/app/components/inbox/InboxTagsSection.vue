<script setup lang="ts">
import type { InboxTag } from '@webvue/contracts'
import { useInboxTags } from '@/composables/inbox/useInbox'
import { useDeleteInboxTag, useSaveInboxTag } from '@/composables/inbox/useInboxSettings'

// Tags classify conversations (for example "complaint" or "appointment"); agents put them on a conversation.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxTags()
const { mutate: save, isPending: saving } = useSaveInboxTag()
const { mutate: remove, isPending: removing } = useDeleteInboxTag()
const items = computed(() => data.value?.items ?? [])
const editing = ref<number | 0 | null>(null)
const name = ref('')
const attempted = ref(false)
const deleting = ref<InboxTag | null>(null)
const locked = computed(() => !hydrated.value || saving.value || removing.value)
const nameError = computed(() => !name.value.trim() ? t('inbox.settings.requiredName') : undefined)

function edit(tag?: InboxTag) {
  editing.value = tag?.id ?? 0
  name.value = tag?.name ?? ''
  attempted.value = false
  deleting.value = null
}
function submit() {
  attempted.value = true
  if (locked.value || nameError.value) return
  save({ id: editing.value || undefined, body: { name: name.value.trim() } }, {
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
  <SharedRecordSection id="tags" variant="panel" class="webvue-settings-anchor" :title="t('inbox.settings.tags.title')" :description="t('inbox.settings.tags.hint')">
    <template #actions>
      <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :disabled="locked" :label="t('inbox.settings.tags.add')" data-testid="inbox-tag-add" @click="edit()" />
    </template>
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <div v-else class="flex flex-col gap-3">
      <form v-if="editing !== null" class="flex flex-wrap items-end gap-2 rounded-control bg-elevated/50 p-3" novalidate @submit.prevent="submit">
        <UFormField class="min-w-48 flex-1" :label="t('inbox.settings.name')" required :error="attempted ? nameError : undefined">
          <UInput v-model="name" class="w-full" maxlength="64" :disabled="locked" data-testid="inbox-tag-name" />
        </UFormField>
        <UButton type="button" color="neutral" variant="outline" :disabled="locked" :label="t('app.cancel')" @click="editing = null" />
        <UButton type="submit" :disabled="locked" :loading="saving" :label="t('app.save')" data-testid="inbox-tag-save" />
      </form>
      <SharedInlineConfirm
        v-if="deleting"
        :title="t('inbox.settings.tags.deleteTitle', { name: deleting.name })"
        :description="t('inbox.settings.tags.deleteDescription')"
        :confirm-label="t('inbox.settings.delete')"
        :pending="removing"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
      <p v-if="!items.length && editing === null" class="text-sm text-muted">{{ t('inbox.settings.tags.empty') }}</p>
      <ul v-else class="flex flex-wrap gap-2">
        <li v-for="tag in items" :key="tag.id" class="inline-flex items-center gap-1 rounded-full bg-elevated ps-3 pe-1 text-sm" :data-testid="`inbox-tag-${tag.id}`">
          <span>{{ tag.name }}</span>
          <UButton type="button" color="neutral" variant="ghost" size="xs" square icon="i-lucide-pencil" :disabled="locked" :aria-label="t('inbox.settings.edit', { name: tag.name })" @click="edit(tag)" />
          <UButton type="button" color="error" variant="ghost" size="xs" square icon="i-lucide-x" :disabled="locked" :aria-label="t('inbox.settings.remove', { name: tag.name })" @click="deleting = tag; editing = null" />
        </li>
      </ul>
    </div>
  </SharedRecordSection>
</template>
