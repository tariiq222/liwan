<script setup lang="ts">
import type { CrmOpportunity, CrmOpportunityCreate, CrmSource } from '@webvue/contracts'
import { crmErrorMessage } from '@/utils/crmErrors'

// The create form of the route-backed panel. The agent is left out of the body unless the user may assign:
// then an agent, or the shared pool (null), can be chosen; otherwise the creator takes the record.
const props = defineProps<{ sources: CrmSource[]; canAssign: boolean; save: (body: CrmOpportunityCreate) => Promise<CrmOpportunity>; cancelTo: string }>()
const emit = defineEmits<{ saved: [opportunity: CrmOpportunity] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const contactName = ref('')
const phone = ref('')
const email = ref('')
const sourceId = ref<number | undefined>()
const agentId = ref<number | null>(null)
const pool = ref(false)
const attempted = ref(false)
const pending = ref(false)
const failure = ref<unknown>(null)

const dirty = computed(() => Boolean(contactName.value || phone.value || email.value || sourceId.value || agentId.value || pool.value))
const phoneError = computed(() => {
  if (attempted.value && !phone.value.trim()) return t('crm.opportunities.form.phoneRequired')
  const error = failure.value as { status?: number; field?: string } | null
  return error?.status === 422 && error.field === 'phone' ? crmErrorMessage(error, t) : undefined
})
const formError = computed(() => (failure.value && !phoneError.value ? crmErrorMessage(failure.value, t) : ''))

async function submit() {
  attempted.value = true
  failure.value = null
  if (!contactName.value.trim() || !phone.value.trim() || pending.value) return
  const body: CrmOpportunityCreate = { contact_name: contactName.value.trim(), phone: phone.value.trim() }
  if (email.value.trim()) body.email = email.value.trim()
  if (sourceId.value) body.source_id = sourceId.value
  if (props.canAssign && pool.value) body.user_id = null
  else if (props.canAssign && agentId.value) body.user_id = agentId.value
  pending.value = true
  try {
    emit('saved', await props.save(body))
  } catch (error) {
    failure.value = error
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <UForm novalidate :state="{}" class="webvue-form" data-testid="crm-opportunity-form" @submit="submit">
    <SharedUnsavedChanges :dirty="dirty && !pending" />
    <SharedFormSection>
      <UFormField :label="t('crm.opportunities.form.contact')" name="contact-name" required :error="attempted && !contactName.trim() ? t('crm.opportunities.form.contactRequired') : undefined">
        <UInput id="contact-name" v-model="contactName" class="w-full" :maxlength="200" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('crm.opportunities.form.phone')" name="contact-phone" required :error="phoneError">
        <UInput id="contact-phone" v-model="phone" type="tel" dir="ltr" class="w-full" :maxlength="200" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('crm.opportunities.form.email')" name="contact-email">
        <UInput id="contact-email" v-model="email" type="email" dir="ltr" class="w-full" :maxlength="254" :disabled="!hydrated || pending" />
      </UFormField>
      <UFormField :label="t('crm.opportunities.form.source')" name="contact-source">
        <USelect id="contact-source" v-model="sourceId" class="w-full" :items="sources.map(source => ({ value: source.id, label: source.name }))" :placeholder="t('crm.opportunities.form.sourceNone')" :disabled="!hydrated || pending" />
      </UFormField>
      <template v-if="canAssign">
        <UFormField :label="t('crm.opportunities.form.agent')" name="contact-agent" :help="t('crm.opportunities.form.agentHint')">
          <SharedPersonPicker id="contact-agent" v-model="agentId" value-key="user_id" :disabled="!hydrated || pending || pool" />
        </UFormField>
        <USwitch v-model="pool" :label="t('crm.opportunities.form.pool')" :disabled="!hydrated || pending" />
      </template>
      <UAlert v-if="formError" role="alert" color="error" variant="subtle" :description="formError" />
    </SharedFormSection>
    <SharedFormActions>
      <UButton type="button" color="neutral" variant="outline" :to="cancelTo" :label="t('app.cancel')" />
      <UButton type="submit" class="ms-auto" :loading="pending" :disabled="!hydrated || pending" :label="t('crm.opportunities.form.submit')" data-testid="crm-opportunity-save" />
    </SharedFormActions>
  </UForm>
</template>
