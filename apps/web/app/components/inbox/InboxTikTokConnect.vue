<script setup lang="ts">
import { InboxTikTokConnectSchema } from '@liwan/contracts'
import { inboxTikTokErrorKey, useConnectInboxTikTok } from '@/composables/inbox/inboxTikTok'
import { useInboxDepartments } from '@/composables/inbox/useInboxSettings'

// Connecting a TikTok account is the channels card's own inline form, not a dialog over it: the notice that TikTok
// processes the message data outside the Kingdom comes first (owner decision O2), then the button, then the short
// form. The API answers the account page; the browser leaves this app for TikTok and comes back to the callback.
const { t } = useI18n()
const hydrated = useHydrated()
const departments = useInboxDepartments()
const { mutateAsync: connect, isPending } = useConnectInboxTikTok()
const NONE = 'none'
const open = ref(false)
const form = reactive({ name: '', department: NONE })
const attempted = ref(false)
const serverError = ref<string | null>(null)
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.settings.channels.noDepartment') },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
])
const payload = computed(() => ({
  name: form.name.trim(),
  department_id: form.department === NONE ? null : Number(form.department),
}))
const valid = computed(() => InboxTikTokConnectSchema.safeParse(payload.value).success)
const off = computed(() => !hydrated.value || isPending.value)
const nameError = computed(() => attempted.value && !form.name.trim() ? t('inbox.settings.channels.invalid.name') : undefined)
// The form is a draft of its own: leaving the card with a half-typed name asks first.
const dirty = computed(() => open.value && (!!form.name.trim() || form.department !== NONE))

function toggle() {
  open.value = !open.value
  attempted.value = false
  serverError.value = null
}

async function submit() {
  attempted.value = true
  serverError.value = null
  if (off.value || !valid.value) return
  try {
    const { authorize_url } = await connect(payload.value)
    window.location.assign(authorize_url)
  } catch (e) {
    const key = inboxTikTokErrorKey(e)
    serverError.value = key ? t(key) : (e instanceof Error ? e.message : t('errors.generic'))
  }
}
</script>

<template>
  <div class="flex flex-col gap-(--liwan-gap-card) py-3" data-testid="inbox-tiktok-connect">
    <p class="text-sm text-muted" data-testid="inbox-tiktok-notice">{{ t('inbox.settings.channels.tiktokNotice') }}</p>
    <div>
      <UButton
        type="button"
        color="neutral"
        variant="outline"
        icon="i-liwan-tiktok"
        :label="t('inbox.settings.channels.tiktokConnect')"
        :aria-expanded="open"
        :disabled="off"
        data-testid="inbox-tiktok-open"
        @click="toggle"
      />
    </div>
    <form v-if="open" class="flex flex-col gap-(--liwan-gap-card)" novalidate @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <UFormField name="name" :label="t('inbox.settings.name')" required :error="nameError">
        <UInput v-model="form.name" class="w-full" maxlength="128" :disabled="off" data-testid="inbox-tiktok-name" />
      </UFormField>
      <UFormField name="department" :label="t('inbox.settings.channels.department')" :description="t('inbox.settings.channels.departmentHint')">
        <USelect v-model="form.department" :items="departmentItems" class="w-full" :disabled="off" />
      </UFormField>
      <p v-if="serverError" class="text-sm text-error" role="alert" data-testid="inbox-tiktok-error">{{ serverError }}</p>
      <div class="flex justify-end">
        <UButton type="submit" :disabled="off || !valid" :loading="isPending" :label="t('inbox.settings.channels.tiktokContinue')" data-testid="inbox-tiktok-submit" />
      </div>
    </form>
  </div>
</template>
