<script setup lang="ts">
import type { InboxBusinessProfile } from '@liwan/contracts'
import InboxProfilePreview from '@/components/inbox/InboxProfilePreview.vue'
import {
  PROFILE_LIMITS, PROFILE_VERTICALS, changedProfileFields, draftPatch, mergeDraft, profileErrors, profileToDraft, type ProfileDraft, type ProfileField,
} from '@/composables/inbox/inboxProfile'
import { useSaveInboxBusinessProfile, useUploadInboxProfilePicture } from '@/composables/inbox/useInboxChannelHealth'

// The WhatsApp business profile as a form with live counters, a picture upload and a preview. It edits a draft of the
// profile read from Meta, sends only the changed fields, and is protected against leaving with unsaved changes. The
// picture is uploaded on its own (it goes to Meta at once) and never disturbs the text being edited.
const props = defineProps<{ channelId: number; channelName: string; appId: string | null; profile: InboxBusinessProfile }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()

const MAX_PICTURE_BYTES = 5 * 1024 * 1024
const NONE = 'none'
const base = ref<ProfileDraft>(profileToDraft(props.profile))
const draft = ref<ProfileDraft>({ ...base.value })
watch(() => props.profile, (next) => {
  const after = profileToDraft(next)
  draft.value = mergeDraft(draft.value, base.value, after)
  base.value = after
})

const { mutate: save, isPending: saving } = useSaveInboxBusinessProfile(() => props.channelId)
const { mutate: upload, isPending: uploading } = useUploadInboxProfilePicture(() => props.channelId)
const busy = computed(() => !hydrated.value || saving.value || uploading.value)
const changed = computed(() => changedProfileFields(base.value, draft.value))
const dirty = computed(() => changed.value.length > 0)
const errors = computed(() => profileErrors(base.value, draft.value))
const invalid = (field: ProfileField) => errors.value.has(field)
const message = (field: ProfileField, key: string) => invalid(field) ? t(`inbox.profile.invalid.${key}`) : undefined
// Isolated left-to-right so "37 / 139" is not mirrored in an Arabic line.
const counter = (field: 'about' | 'address' | 'description') => `\u2066${t('inbox.profile.counter', { used: draft.value[field].length, max: PROFILE_LIMITS[field] })}\u2069`

const verticalItems = computed(() => [
  { value: NONE, label: t('inbox.profile.hints.noVertical') },
  ...PROFILE_VERTICALS.map(value => ({ value, label: t(`inbox.profile.vertical.${value}`) })),
])
const preview = computed(() => ({
  about: draft.value.about, address: draft.value.address, description: draft.value.description, email: draft.value.email,
  websites: [draft.value.website1.trim(), draft.value.website2.trim()], vertical: draft.value.vertical, pictureUrl: props.profile.picture_url,
}))

const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
function submit() {
  if (busy.value || !dirty.value || errors.value.size) return
  save(draftPatch(base.value, draft.value), { onSuccess: () => toast.add({ title: t('inbox.profile.saved'), color: 'success' }), onError: fail })
}
function discard() {
  draft.value = { ...base.value }
}

const pictureError = ref('')
const picker = ref<{ reset: () => void } | null>(null)
function onPicture(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  pictureError.value = ''
  if (!file) return
  if (file.type !== 'image/jpeg' && file.type !== 'image/png') pictureError.value = t('inbox.profile.picture.type')
  else if (file.size > MAX_PICTURE_BYTES) pictureError.value = t('inbox.profile.picture.size')
  if (pictureError.value) return picker.value?.reset()
  upload(file, { onSuccess: () => toast.add({ title: t('inbox.profile.picture.uploaded'), color: 'success' }), onError: fail, onSettled: () => picker.value?.reset() })
}
</script>

<template>
  <div data-testid="inbox-profile">
    <SharedUnsavedChanges :dirty="dirty" />
    <div class="grid min-w-0 items-start gap-(--liwan-gap-card) lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div class="flex min-w-0 flex-col gap-(--liwan-gap-card)">
      <SharedRecordSection variant="panel" :title="t('inbox.profile.picture.title')" :description="t('inbox.profile.picture.hint')">
        <div class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-4">
            <UAvatar :src="profile.picture_url ?? undefined" icon="i-lucide-store" size="3xl" :alt="t('inbox.profile.picture.aria')" />
            <SharedFileField ref="picker" accept="image/jpeg,image/png" :label="t('inbox.profile.picture.choose')" :aria-label="t('inbox.profile.picture.choose')" :disabled="busy || !appId" data-testid="inbox-profile-picture" @change="onPicture" />
            <span v-if="uploading" class="text-sm text-muted" role="status">{{ t('inbox.profile.picture.uploading') }}</span>
          </div>
          <p v-if="pictureError" role="alert" class="text-sm text-error" data-testid="inbox-profile-picture-error">{{ pictureError }}</p>
          <UAlert
            v-if="!appId" color="info" variant="subtle" icon="i-lucide-info" :title="t('inbox.profile.picture.needsAppId')" data-testid="inbox-profile-needs-app-id"
            :actions="[{ label: t('inbox.profile.picture.appIdLink'), to: `/settings/apps/inbox/channels/${channelId}`, color: 'neutral', variant: 'outline' }]"
          />
        </div>
      </SharedRecordSection>

      <form @submit.prevent="submit">
        <SharedRecordSection variant="panel" :title="t('inbox.profile.title')" :description="t('inbox.profile.description')">
          <div class="flex flex-col gap-4">
            <UFormField :label="t('inbox.profile.fields.about')" :description="t('inbox.profile.hints.about')" :hint="counter('about')" :error="message('about', 'about')" required>
              <UTextarea v-model="draft.about" class="w-full" :rows="2" :maxlength="PROFILE_LIMITS.about" :disabled="busy" data-testid="inbox-profile-about" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.description')" :hint="counter('description')" :error="message('description', 'description')">
              <UTextarea v-model="draft.description" class="w-full" :rows="4" :maxlength="PROFILE_LIMITS.description" :disabled="busy" data-testid="inbox-profile-description" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.address')" :hint="counter('address')" :error="message('address', 'address')">
              <UInput v-model="draft.address" class="w-full" :maxlength="PROFILE_LIMITS.address" :disabled="busy" data-testid="inbox-profile-address" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.email')" :error="message('email', 'email')">
              <UInput v-model="draft.email" type="email" class="w-full" dir="ltr" :maxlength="PROFILE_LIMITS.email" autocomplete="off" :disabled="busy" data-testid="inbox-profile-email" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.website1')" :description="t('inbox.profile.hints.websites')" :error="message('website1', 'website')">
              <UInput v-model="draft.website1" type="url" class="w-full" dir="ltr" placeholder="https://" :maxlength="PROFILE_LIMITS.website" autocomplete="off" :disabled="busy" data-testid="inbox-profile-website1" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.website2')" :error="message('website2', 'website')">
              <UInput v-model="draft.website2" type="url" class="w-full" dir="ltr" placeholder="https://" :maxlength="PROFILE_LIMITS.website" autocomplete="off" :disabled="busy" data-testid="inbox-profile-website2" />
            </UFormField>
            <UFormField :label="t('inbox.profile.fields.vertical')">
              <USelect :model-value="draft.vertical || NONE" :items="verticalItems" class="w-full" :disabled="busy" data-testid="inbox-profile-vertical" @update:model-value="draft.vertical = $event === NONE ? '' : ($event as ProfileDraft['vertical'])" />
            </UFormField>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton type="button" color="neutral" variant="ghost" :disabled="busy || !dirty" :label="t('inbox.profile.reset')" data-testid="inbox-profile-reset" @click="discard" />
              <UButton type="submit" :loading="saving" :disabled="busy || !dirty || errors.size > 0" :label="t('inbox.profile.save')" data-testid="inbox-profile-save" />
            </div>
          </div>
        </SharedRecordSection>
      </form>
    </div>

    <aside class="flex min-w-0 flex-col gap-2 lg:sticky lg:top-4" :aria-label="t('inbox.profile.preview.title')">
      <h2 class="text-sm font-semibold text-highlighted">{{ t('inbox.profile.preview.title') }}</h2>
      <p class="text-sm text-muted">{{ t('inbox.profile.preview.hint') }}</p>
      <InboxProfilePreview :name="channelName" :profile="preview" />
    </aside>
    </div>
  </div>
</template>
