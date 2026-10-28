<script setup lang="ts">
import { InboxChannelCreateSchema, type InboxChannel } from '@webvue/contracts'
import { useInboxDepartments, useCreateInboxChannel } from '@/composables/inbox/useInboxSettings'

// Connects a WhatsApp Cloud API number. The access token and the app secret are write-only: they are sent once, never
// shown again, and never leave this form's memory except in the create request.
const props = defineProps<{ backTo: string }>()
const emit = defineEmits<{ saved: [channel: InboxChannel] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const departments = useInboxDepartments()
const { mutateAsync: create, isPending } = useCreateInboxChannel()
const NONE = 'none'
const form = reactive({ name: '', department: NONE, phone_number_id: '', business_account_id: '', access_token: '', app_secret: '' })
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.settings.channels.noDepartment') },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
])
const payload = computed(() => ({
  name: form.name.trim(),
  kind: 'whatsapp' as const,
  department_id: form.department === NONE ? null : Number(form.department),
  phone_number_id: form.phone_number_id.trim(),
  business_account_id: form.business_account_id.trim(),
  access_token: form.access_token.trim(),
  app_secret: form.app_secret.trim(),
}))
const invalidFields = computed(() => {
  const parsed = InboxChannelCreateSchema.safeParse(payload.value)
  return new Set(parsed.success ? [] : parsed.error.issues.map(issue => String(issue.path[0])))
})
const saved = ref(false)
const dirty = computed(() => !saved.value && !!(form.name || form.phone_number_id || form.business_account_id || form.access_token || form.app_secret))
function fieldError(field: keyof typeof form) {
  if (serverError.value?.field === field) return serverError.value.message
  return attempted.value && invalidFields.value.has(field === 'department' ? 'department_id' : field) ? t(`inbox.settings.channels.invalid.${field}`) : undefined
}

async function submit() {
  attempted.value = true
  serverError.value = null
  if (!hydrated.value || isPending.value || invalidFields.value.size) return
  try {
    const channel = await create(payload.value)
    saved.value = true
    emit('saved', channel)
  } catch (e) {
    const field = (e as { field?: string }).field
    serverError.value = { field, message: e instanceof Error ? e.message : t('errors.generic') }
  }
}
</script>

<template>
  <form class="space-y-6" novalidate @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('inbox.settings.channels.form.account')" :description="t('inbox.settings.channels.form.accountHint')">
      <div class="grid gap-4">
        <UFormField name="name" :label="t('inbox.settings.name')" required :error="fieldError('name')">
          <UInput v-model="form.name" class="w-full" maxlength="128" :disabled="!hydrated || isPending" data-testid="inbox-channel-name" />
        </UFormField>
        <UFormField name="department" :label="t('inbox.settings.channels.department')" :description="t('inbox.settings.channels.departmentHint')">
          <USelect v-model="form.department" :items="departmentItems" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <UFormField name="phone_number_id" :label="t('inbox.settings.channels.phoneNumberId')" :description="t('inbox.settings.channels.phoneNumberIdHint')" required :error="fieldError('phone_number_id')">
          <UInput v-model="form.phone_number_id" class="w-full" dir="ltr" inputmode="numeric" autocomplete="off" :disabled="!hydrated || isPending" data-testid="inbox-channel-phone-id" />
        </UFormField>
        <UFormField name="business_account_id" :label="t('inbox.settings.channels.businessAccountId')" :description="t('inbox.settings.channels.businessAccountIdHint')" required :error="fieldError('business_account_id')">
          <UInput v-model="form.business_account_id" class="w-full" dir="ltr" inputmode="numeric" autocomplete="off" :disabled="!hydrated || isPending" data-testid="inbox-channel-waba-id" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormSection panel :title="t('inbox.settings.channels.form.secrets')" :description="t('inbox.settings.channels.form.secretsHint')">
      <div class="grid gap-4">
        <UFormField name="access_token" :label="t('inbox.settings.channels.accessToken')" required :error="fieldError('access_token')">
          <UInput v-model="form.access_token" type="password" class="w-full" dir="ltr" autocomplete="off" :disabled="!hydrated || isPending" data-testid="inbox-channel-token" />
        </UFormField>
        <UFormField name="app_secret" :label="t('inbox.settings.channels.appSecret')" :description="t('inbox.settings.channels.appSecretHint')" required :error="fieldError('app_secret')">
          <UInput v-model="form.app_secret" type="password" class="w-full" dir="ltr" autocomplete="off" :disabled="!hydrated || isPending" data-testid="inbox-channel-secret" />
        </UFormField>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :disabled="!hydrated || isPending" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated" :loading="isPending" :label="t('inbox.settings.channels.create')" data-testid="inbox-channel-submit" />
      </div>
    </SharedFormActions>
  </form>
</template>
