<script setup lang="ts">
import { InboxCannedReplyWriteSchema, type InboxCannedReply } from '@liwan/contracts'
import { useSaveInboxCannedReply } from '@/composables/inbox/useInboxSettings'
import { saveErrorMessage } from '@/utils/formFeedback'

// Form for creating or editing a canned reply shortcut and body.
const props = defineProps<{ reply?: InboxCannedReply }>()
const emit = defineEmits<{ done: []; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: save, isPending: saving } = useSaveInboxCannedReply()

const shortcut = ref(props.reply?.shortcut ?? '')
const body = ref(props.reply?.body ?? '')
const initialShortcut = ref(shortcut.value)
const initialBody = ref(body.value)
const attempted = ref(false)
const submitted = ref(false)
const failure = ref<unknown>(null)

const locked = computed(() => !hydrated.value || saving.value)
const draft = computed(() => ({ shortcut: shortcut.value.trim().replace(/^\//, ''), body: body.value.trim() }))
const valid = computed(() => InboxCannedReplyWriteSchema.safeParse(draft.value).success)
const dirty = computed(() => !submitted.value && (shortcut.value !== initialShortcut.value || body.value !== initialBody.value))

async function submit() {
  attempted.value = true
  if (locked.value || !valid.value) return
  failure.value = null
  try {
    await save({ id: props.reply?.id, body: draft.value })
    initialShortcut.value = shortcut.value
    initialBody.value = body.value
    submitted.value = true
    emit('done')
  } catch (error) {
    failure.value = error
  }
}
</script>

<template>
  <UForm :state="{ shortcut, body }" class="liwan-form" method="post" :loading-auto="false" novalidate data-testid="inbox-canned-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="t('app.saveFailed')" :description="saveErrorMessage(failure, t('errors.generic'), t('errors.saveUncertain'))" />
    <UFormField :label="t('inbox.settings.canned.shortcut')" name="inbox-canned-shortcut" :description="t('inbox.settings.canned.shortcutHint')" required :error="attempted && !draft.shortcut ? t('inbox.settings.requiredName') : undefined">
      <UInput id="inbox-canned-shortcut" v-model="shortcut" class="w-full" maxlength="32" dir="auto" :disabled="locked" data-testid="inbox-canned-shortcut" />
    </UFormField>
    <UFormField :label="t('inbox.settings.canned.body')" name="inbox-canned-body" required :error="attempted && !draft.body ? t('inbox.settings.canned.requiredBody') : undefined">
      <UTextarea id="inbox-canned-body" v-model="body" class="w-full" :rows="4" maxlength="4096" :disabled="locked" data-testid="inbox-canned-body" />
    </UFormField>
    <SharedFormActions>
      <div class="ms-auto flex items-center gap-2">
        <UButton type="button" color="neutral" variant="outline" :disabled="saving" :label="t('app.cancel')" @click="emit('cancel')" />
        <UButton type="submit" :disabled="locked" :loading="saving" :label="reply ? t('app.saveChanges') : t('app.create')" data-testid="inbox-canned-save" />
      </div>
    </SharedFormActions>
  </UForm>
</template>
