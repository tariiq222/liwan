<script lang="ts">
import type { CrmOpportunity, CrmOpportunityPatch } from '@liwan/contracts'

/** The contact fields being edited, as the form holds them. */
export interface CrmContactDraft {
  contact_name: string
  phone: string
  email: string
  source_id: number | null
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** The draft's own refusals, by field name: a name and a phone are required, an email must look like one. */
export function contactDraftErrors(draft: CrmContactDraft): Partial<Record<keyof CrmContactDraft, 'required' | 'invalid'>> {
  const errors: Partial<Record<keyof CrmContactDraft, 'required' | 'invalid'>> = {}
  if (!draft.contact_name.trim()) errors.contact_name = 'required'
  if (!draft.phone.trim()) errors.phone = 'required'
  const email = draft.email.trim()
  if (email && !EMAIL.test(email)) errors.email = 'invalid'
  return errors
}

/** The partial patch of a draft: only the fields that differ from the record, the source as null when cleared. */
export function contactPatch(record: Pick<CrmOpportunity, 'contact_name' | 'phone' | 'email' | 'source'>, draft: CrmContactDraft): CrmOpportunityPatch {
  const patch: CrmOpportunityPatch = {}
  if (draft.contact_name !== record.contact_name) patch.contact_name = draft.contact_name
  if (draft.phone !== record.phone) patch.phone = draft.phone
  if (draft.email !== record.email) patch.email = draft.email
  if (draft.source_id !== (record.source?.id ?? null)) patch.source_id = draft.source_id
  return patch
}
</script>

<script setup lang="ts">
import type { CrmSource } from '@liwan/contracts'
import { crmErrorMessage } from '@/utils/crmErrors'

// Correcting an opportunity's contact data (the server's PATCH accepts these four fields). The drafts live until the
// editor closes: a refused save keeps what the user typed, and the server's field refusals show under their field.
const props = defineProps<{ record: CrmOpportunity; sources: CrmSource[]; pending?: boolean; disabled?: boolean; error?: unknown }>()
const emit = defineEmits<{ save: [patch: ReturnType<typeof contactPatch>]; cancel: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
// The patch is built against the snapshot the editor opened from: a background refetch of the record must not
// turn untouched fields into changes that would overwrite another user's correction.
const snapshot = ref<CrmContactDraft>({
  contact_name: props.record.contact_name,
  phone: props.record.phone,
  email: props.record.email,
  source_id: props.record.source?.id ?? null,
})
const draft = ref<CrmContactDraft>({ ...snapshot.value })
const attempted = ref(false)
const dirty = defineModel<boolean>('dirty', { default: false })
const patch = computed(() => contactPatch(snapshot.value, draft.value))
watch(patch, value => { dirty.value = Object.keys(value).length > 0 }, { immediate: true })
onBeforeUnmount(() => { dirty.value = false })

const field = computed(() => (props.error as { field?: string } | undefined)?.field)
const serverError = (name: string) => (field.value === name ? crmErrorMessage(props.error, t) : undefined)
const localErrors = computed(() => (attempted.value ? contactDraftErrors(draft.value) : {}))
const LOCAL_KEYS = {
  contact_name: 'crm.opportunities.form.contactRequired',
  phone: 'crm.opportunities.form.phoneRequired',
  email: 'crm.opportunities.contact.invalidEmail',
} as const
type EditableField = keyof typeof LOCAL_KEYS
const localError = (name: EditableField) => {
  const failure = localErrors.value[name]
  return failure === 'required' || failure === 'invalid' ? t(LOCAL_KEYS[name]) : undefined
}
const nameError = computed(() => localError('contact_name') ?? serverError('contact_name'))
const phoneError = computed(() => localError('phone') ?? serverError('phone'))
const emailError = computed(() => localError('email') ?? serverError('email'))
const sourceError = computed(() => serverError('source_id'))
const locked = computed(() => !hydrated.value || Boolean(props.pending) || Boolean(props.disabled))
// The active sources, plus the explicit "no source" choice the server takes as false.
const sourceItems = computed(() => [
  { value: null as number | null, label: t('crm.opportunities.form.sourceNone') },
  ...props.sources.map(source => ({ value: source.id as number | null, label: source.name })),
])

function submit() {
  attempted.value = true
  if (Object.keys(contactDraftErrors(draft.value)).length) return
  if (!Object.keys(patch.value).length) return
  emit('save', { ...patch.value })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('crm.opportunities.contact.title')">
    <UForm novalidate :state="{}" class="liwan-form" data-testid="crm-contact-form" @submit="submit">
      <div class="grid gap-4">
        <UFormField :label="t('crm.opportunities.form.contact')" name="contact-edit-name" required :error="nameError">
          <UInput id="contact-edit-name" v-model="draft.contact_name" class="w-full" :maxlength="200" :disabled="locked" data-testid="crm-contact-name" />
        </UFormField>
        <div class="liwan-auto-grid gap-4">
          <UFormField :label="t('crm.opportunities.form.phone')" name="contact-edit-phone" required :error="phoneError">
            <UInput id="contact-edit-phone" v-model="draft.phone" type="tel" dir="ltr" class="w-full" :maxlength="200" :disabled="locked" data-testid="crm-contact-phone" />
          </UFormField>
          <UFormField :label="t('crm.opportunities.form.email')" name="contact-edit-email" :error="emailError">
            <UInput id="contact-edit-email" v-model="draft.email" type="email" dir="ltr" class="w-full" :maxlength="254" :disabled="locked" data-testid="crm-contact-email" />
          </UFormField>
        </div>
        <UFormField :label="t('crm.opportunities.form.source')" name="contact-edit-source" :error="sourceError">
          <USelect id="contact-edit-source" v-model="draft.source_id" class="w-full" :items="sourceItems" :disabled="locked" data-testid="crm-contact-source" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" :label="t('app.cancel')" :disabled="locked" data-testid="crm-contact-cancel" @click="emit('cancel')" />
          <UButton type="submit" :loading="pending" :disabled="locked || !dirty" :label="t('crm.opportunities.contact.submit')" data-testid="crm-contact-save" />
        </div>
      </div>
    </UForm>
  </SharedRecordSection>
</template>
