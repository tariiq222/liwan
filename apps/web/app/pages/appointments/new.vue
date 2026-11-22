<script setup lang="ts">
import SharedDateField from '@liwan/ui/app/components/shared/form/DateField.vue'
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { bookingTimestamp } from '@/utils/appointmentTime'
import { useAppointmentBookingMutation, useAppointmentTypes } from '@/composables/appointments/useAppointments'

// A staff booking: the type, the requester and the time. `walk_in` marks a person who arrived without an appointment,
// which is why the requester is typed here rather than picked from the customer list: a walk-in may be new.
const route = useRoute()
const { t } = useI18n()
const { can } = useAccess()
const hydrated = useHydrated()
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/appointments', ['/appointments']))
const types = useAppointmentTypes(computed(() => hydrated.value && can('appointments.bookings.manage')))
const mutation = useAppointmentBookingMutation()

const typeId = ref<string>('')
const requesterName = ref('')
const requesterPhone = ref('')
const day = ref('')
const time = ref('')
const walkIn = ref(false)
const notes = ref('')
const attempted = ref(false)
const failure = ref<string | null>(null)
const saving = computed(() => mutation.isPending.value)

const typeItems = computed(() => (types.data.value?.items ?? []).map(type => ({ value: String(type.id), label: type.name })))
// The wire form the server validates: whole seconds, no `.000` (utils/appointmentTime).
const start = computed(() => bookingTimestamp(day.value, time.value))
const typeError = computed(() => attempted.value && !typeId.value ? t('appointments.form.typeRequired') : undefined)
const nameError = computed(() => attempted.value && !requesterName.value.trim() ? t('appointments.form.nameRequired') : undefined)
const timeError = computed(() => attempted.value && !start.value ? t('appointments.form.timeRequired') : undefined)

async function save() {
  attempted.value = true
  if (!hydrated.value || saving.value || !typeId.value || !requesterName.value.trim() || !start.value) return
  failure.value = null
  try {
    const created = await mutation.mutateAsync({
      action: 'create',
      body: {
        type_id: Number(typeId.value),
        requester: { name: requesterName.value.trim(), ...(requesterPhone.value.trim() ? { phone: requesterPhone.value.trim() } : {}) },
        start: start.value,
        walk_in: walkIn.value,
        notes: notes.value.trim() || null,
      },
    })
    // Only a create answers a booking; the union includes the invitation's `{path}`.
    if (!('id' in created)) return
    await navigateTo({ path: `/appointments/${created.id}`, query: { returnTo: backTo.value } })
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('errors.generic')
  }
}
</script>

<template>
  <!-- The list behind the panel, as every create panel over a list has. -->
  <SharedListPage :title="t('appointments.title')" hide-header />
  <SharedCreatePanel :title="t('appointments.list.new')" :back-to="backTo">
    <SharedUnsavedChanges :dirty="Boolean(typeId || requesterName || day || time)" />
    <form class="liwan-form" novalidate data-testid="appointments-create-form" @submit.prevent="save">
      <UFormField :label="t('appointments.form.type')" name="appointments-type" required :error="typeError">
        <USelect id="appointments-type" v-model="typeId" :items="typeItems" class="w-full" :placeholder="t('appointments.form.chooseType')" :disabled="!hydrated || saving" data-testid="appointments-form-type" />
      </UFormField>
      <UFormField :label="t('appointments.form.requester')" name="appointments-requester" required :error="nameError">
        <UInput id="appointments-requester" v-model="requesterName" class="w-full" :disabled="!hydrated || saving" data-testid="appointments-form-name" />
      </UFormField>
      <UFormField :label="t('appointments.form.phone')" name="appointments-phone">
        <UInput id="appointments-phone" v-model="requesterPhone" dir="ltr" class="w-full" :disabled="!hydrated || saving" data-testid="appointments-form-phone" />
      </UFormField>
      <div class="liwan-auto-grid gap-4">
        <UFormField :label="t('appointments.record.day')" name="appointments-day" required :error="timeError">
          <SharedDateField id="appointments-day" :model-value="day" :disabled="!hydrated || saving" data-testid="appointments-form-day" @update:model-value="value => { day = value ?? '' }" />
        </UFormField>
        <UFormField :label="t('appointments.record.time')" name="appointments-time" required>
          <UInput id="appointments-time" v-model="time" type="time" class="w-full" :disabled="!hydrated || saving" data-testid="appointments-form-time" />
        </UFormField>
      </div>
      <UFormField :label="t('appointments.form.walkIn')" name="appointments-walk-in">
        <USwitch v-model="walkIn" :disabled="!hydrated || saving" data-testid="appointments-form-walk-in" />
        <p class="text-sm text-muted">{{ t('appointments.form.walkInHint') }}</p>
      </UFormField>
      <UFormField :label="t('appointments.record.notes')" name="appointments-notes">
        <UTextarea id="appointments-notes" v-model="notes" class="w-full" :rows="3" :maxlength="2000" :disabled="!hydrated || saving" data-testid="appointments-form-notes" />
      </UFormField>
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :title="failure" data-testid="appointments-create-error" />
      <SharedFormActions>
        <div class="ms-auto flex flex-wrap items-center gap-2">
          <UButton type="button" color="neutral" variant="outline" :to="backTo" :disabled="saving" :label="t('app.cancel')" />
          <UButton type="submit" :disabled="!hydrated || saving" :loading="saving" :label="t('app.save')" data-testid="appointments-create-save" />
        </div>
      </SharedFormActions>
    </form>
  </SharedCreatePanel>
</template>
