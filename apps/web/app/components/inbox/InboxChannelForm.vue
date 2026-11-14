<script setup lang="ts">
import { InboxChannelCreateSchema, type InboxChannel, type InboxChannelKind } from '@liwan/contracts'
import { connectionOptionLabel, selectableAccounts } from '@/composables/inbox/inboxChannelConnection'
import { channelKindLabelKey } from '@/composables/inbox/inboxChannelKind'
import { useCreateInboxChannel, useInboxChannelAccounts, useInboxDepartments } from '@/composables/inbox/useInboxSettings'

// Creates a channel on an account that is already connected at /settings/integrations: the form picks that account and
// holds no credential. The accounts come from the inbox's own route, so a holder of the channels capability needs no
// access to the integrations page; the page passes the kinds the tenant may create. A WhatsApp channel also names its
// number under the account, a TikTok one needs nothing more.
const props = defineProps<{ backTo: string; kinds: readonly InboxChannelKind[] }>()
const emit = defineEmits<{ saved: [channel: InboxChannel] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { can } = useAccess()
const departments = useInboxDepartments()
const { mutateAsync: create, isPending } = useCreateInboxChannel()
const NONE = 'none'
const form = reactive({ name: '', kind: props.kinds[0] ?? 'whatsapp', department: NONE, connection: '', phone_number_id: '' })
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const isWhatsapp = computed(() => form.kind === 'whatsapp')
const kindItems = computed(() => props.kinds.map(kind => ({ value: kind, label: t(channelKindLabelKey(kind)) })))
const departmentItems = computed(() => [
  { value: NONE, label: t('inbox.settings.channels.noDepartment') },
  ...(departments.data.value?.items ?? []).map(department => ({ value: String(department.id), label: department.name })),
])
const accountsQuery = useInboxChannelAccounts(() => form.kind)
const accounts = computed(() => selectableAccounts(accountsQuery.data.value?.items ?? []))
const connectionItems = computed(() => accounts.value.map(account => ({ value: String(account.id), label: connectionOptionLabel(account) })))
// One account to pick from is picked already; a kind change drops a choice that is not of the new provider.
watch(accounts, (list) => {
  if (!list.some(account => String(account.id) === form.connection)) form.connection = list.length === 1 ? String(list[0]!.id) : ''
}, { immediate: true })

const payload = computed(() => ({
  name: form.name.trim(),
  kind: form.kind,
  department_id: form.department === NONE ? null : Number(form.department),
  connection_id: Number(form.connection),
  ...(isWhatsapp.value ? { phone_number_id: form.phone_number_id.trim() } : {}),
}))
const invalidFields = computed(() => {
  const parsed = InboxChannelCreateSchema.safeParse(payload.value)
  return new Set(parsed.success ? [] : parsed.error.issues.map(issue => String(issue.path[0])))
})
const saved = ref(false)
const dirty = computed(() => !saved.value && !!(form.name || form.phone_number_id))
const providerLabel = computed(() => t(channelKindLabelKey(form.kind)))
const FIELD_KEY: Record<string, string> = { department: 'department_id', connection: 'connection_id' }
function fieldError(field: keyof typeof form) {
  const wire = FIELD_KEY[field] ?? field
  if (serverError.value?.field === wire) return serverError.value.message
  return attempted.value && invalidFields.value.has(wire) ? t(`inbox.settings.channels.invalid.${wire}`) : undefined
}

async function submit() {
  attempted.value = true
  serverError.value = null
  if (!hydrated.value || isPending.value || invalidFields.value.size) return
  try {
    const channel = await create(InboxChannelCreateSchema.parse(payload.value))
    saved.value = true
    emit('saved', channel)
  } catch (e) {
    const field = (e as { field?: string }).field
    serverError.value = { field, message: e instanceof Error ? e.message : t('errors.generic') }
  }
}
</script>

<template>
  <form class="liwan-form" novalidate @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedFormSection panel :title="t('inbox.settings.channels.form.account')" :description="t('inbox.settings.channels.form.accountHint')">
      <div class="grid gap-4">
        <UFormField name="kind" :label="t('inbox.settings.channels.kind')">
          <USelect v-model="form.kind" :items="kindItems" class="w-full" :disabled="!hydrated || isPending || kindItems.length < 2" data-testid="inbox-channel-kind" />
        </UFormField>
        <UFormField name="name" :label="t('inbox.settings.name')" required :error="fieldError('name')">
          <UInput v-model="form.name" class="w-full" maxlength="128" :disabled="!hydrated || isPending" data-testid="inbox-channel-name" />
        </UFormField>
        <UFormField name="department" :label="t('inbox.settings.channels.department')" :description="t('inbox.settings.channels.departmentHint')">
          <USelect v-model="form.department" :items="departmentItems" class="w-full" :disabled="!hydrated || isPending" />
        </UFormField>
        <SharedLoadingSkeleton v-if="accountsQuery.isLoading.value" />
        <SharedPageState v-else-if="accountsQuery.error.value" :error="accountsQuery.error.value" @retry="accountsQuery.refetch()" />
        <UFormField v-else-if="accounts.length" name="connection" :label="t('inbox.settings.channels.connection')" :description="t('inbox.settings.channels.connectionHint', { provider: providerLabel })" required :error="fieldError('connection')">
          <USelect v-model="form.connection" :items="connectionItems" :placeholder="t('inbox.settings.channels.connectionPlaceholder')" class="w-full" :disabled="!hydrated || isPending" data-testid="inbox-channel-connection" />
        </UFormField>
        <p v-else class="flex flex-wrap items-center gap-x-2 text-sm text-muted" data-testid="inbox-channel-no-connection">
          {{ t('inbox.settings.channels.connectionEmpty', { provider: providerLabel }) }}
          <UButton v-if="can('integrations.read')" to="/settings/integrations" variant="link" color="primary" size="sm" class="p-0" :label="t('inbox.settings.channels.connectionEmptyLink')" data-testid="inbox-channel-integrations-link" />
          <template v-else>{{ t('inbox.settings.channels.connectionAskAdmin') }}</template>
        </p>
        <UFormField v-if="isWhatsapp" name="phone_number_id" :label="t('inbox.settings.channels.phoneNumberId')" :description="t('inbox.settings.channels.phoneNumberIdHint')" required :error="fieldError('phone_number_id')">
          <UInput v-model="form.phone_number_id" class="w-full" dir="ltr" inputmode="numeric" autocomplete="off" :disabled="!hydrated || isPending" data-testid="inbox-channel-phone-id" />
        </UFormField>
        <p v-else class="text-sm text-muted" data-testid="inbox-tiktok-notice">{{ t('inbox.settings.channels.tiktokNotice') }}</p>
      </div>
    </SharedFormSection>
    <SharedFormActions>
      <div class="ms-auto flex flex-wrap gap-2">
        <UButton type="button" color="neutral" variant="outline" :to="props.backTo" :disabled="!hydrated || isPending" :label="t('app.cancel')" />
        <UButton type="submit" :disabled="!hydrated || !accounts.length" :loading="isPending" :label="t('inbox.settings.channels.create')" data-testid="inbox-channel-submit" />
      </div>
    </SharedFormActions>
  </form>
</template>
