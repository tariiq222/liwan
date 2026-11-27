<script setup lang="ts">
import type { InboxTag } from '@liwan/contracts'
import { committedName } from '@liwan/ui/app/utils/settingsListName'
import { useInboxTags } from '@/composables/inbox/useInbox'
import { useDeleteInboxTag, useSaveInboxTag } from '@/composables/inbox/useInboxSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Tags classify conversations (for example "complaint" or "appointment"); agents put them on a conversation.
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const canManage = computed(() => can('inbox.settings.manage'))
const { data, isLoading, error, refetch } = useInboxTags()
const { mutateAsync: save } = useSaveInboxTag()
const { mutateAsync: remove, isPending: removing } = useDeleteInboxTag()
const items = computed(() => data.value?.items ?? [])
const newName = ref('')
const adding = ref(false)
const busyId = ref<number | null>(null)
const deleting = ref<InboxTag | null>(null)
const errorMessage = ref('')
const locked = computed(() => !hydrated.value || adding.value || removing.value || busyId.value !== null)

async function addTag() {
  const name = newName.value.trim()
  if (locked.value || !canManage.value || !name) return
  errorMessage.value = ''
  adding.value = true
  try {
    await save({ body: { name } })
    newName.value = ''
  } catch (e) {
    errorMessage.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  } finally {
    adding.value = false
  }
}

async function commitRename(tag: InboxTag, event: Event) {
  const input = event.target as HTMLInputElement
  const name = committedName(input, tag.name)
  if (!name || locked.value || !canManage.value) return
  errorMessage.value = ''
  busyId.value = tag.id
  try {
    await save({ id: tag.id, body: { name } })
  } catch (e) {
    input.value = tag.name
    errorMessage.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  } finally {
    busyId.value = null
  }
}

async function confirmDelete() {
  if (!deleting.value || !canManage.value || locked.value) return
  errorMessage.value = ''
  const target = deleting.value
  busyId.value = target.id
  try {
    await remove(target.id)
    deleting.value = null
  } catch (e) {
    errorMessage.value = saveErrorMessage(e, t('errors.generic'), t('errors.saveUncertain'))
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <SharedSettingsList
    id="tags"
    :title="t('inbox.settings.tags.title')"
    :description="t('inbox.settings.tags.hint')"
    :can-edit="canManage"
    :message="errorMessage"
    :loading="isLoading"
    :error="data ? null : error"
    :empty="!items.length"
    :adding="adding"
    :add-disabled="locked || !newName.trim()"
    @retry="refetch()"
    @add="addTag"
  >
    <li v-for="tag in items" :key="tag.id" class="flex flex-wrap items-center gap-2" data-slot="settings-list-row" :data-testid="`inbox-tag-${tag.id}`">
      <UInput :model-value="tag.name" class="min-w-40 flex-1" :aria-label="t('app.list.name')" :maxlength="64" :disabled="locked || !canManage" @change="commitRename(tag, $event)" />
      <UButton
        v-if="canManage"
        type="button"
        color="error"
        variant="ghost"
        size="sm"
        square
        icon="i-lucide-trash-2"
        :disabled="locked"
        :aria-label="t('inbox.settings.remove', { name: tag.name })"
        @click="deleting = tag"
      />
      <SharedInlineConfirm
        v-if="deleting?.id === tag.id"
        class="basis-full"
        :title="t('inbox.settings.tags.deleteTitle', { name: tag.name })"
        :description="t('inbox.settings.tags.deleteDescription')"
        :confirm-label="t('inbox.settings.delete')"
        :pending="removing"
        @confirm="confirmDelete"
        @cancel="deleting = null"
      />
    </li>
    <template v-if="canManage" #add>
      <UInput v-model="newName" class="min-w-40 flex-1" :placeholder="t('app.list.newName')" :aria-label="t('inbox.settings.name')" :maxlength="64" :disabled="locked || !canManage" data-testid="inbox-tag-name" />
    </template>
  </SharedSettingsList>
</template>
