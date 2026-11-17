<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { HelpdeskTicket, HelpdeskTicketCreate } from '@liwan/contracts'
import { plainTextFromHtml } from '@/utils/meetingMinutesForm'
import { useHelpdeskReference, useCreateHelpdeskTicket, useUpdateHelpdeskTicket } from '@/composables/helpdesk/useHelpdesk'

// The create form of the route-backed panel and the edit page of a ticket: subject, description, the team and the
// classification, plus the customer when an agent opens the ticket for one. The server validates every value again.
// `forCustomer` stays undefined when absent (a Boolean prop would read false), so the agent's own right decides the picker.
const props = withDefaults(
  defineProps<{ ticket?: HelpdeskTicket | null; backTo: RouteLocationRaw; forCustomer?: boolean }>(),
  { ticket: undefined, forCustomer: undefined },
)
const emit = defineEmits<{ saved: [ticket: HelpdeskTicket] }>()
const { t } = useI18n()
const { can } = useAccess()
// A field the server rendered from a record value and the browser hydrated with another would drop what the user
// typed, so the form stays disabled until hydration finished (the same rule the ticket thread follows).
const hydrated = useHydrated()
const reference = useHelpdeskReference()
const create = useCreateHelpdeskTicket()
const patch = useUpdateHelpdeskTicket()
const router = useRouter()
const editing = computed(() => Boolean(props.ticket))
const off = computed(() => !hydrated.value || create.isPending.value || patch.isPending.value)

const subject = ref(props.ticket?.subject ?? '')
const description = ref(plainTextFromHtml(props.ticket?.description))
const teamId = ref<number | undefined>(props.ticket?.team?.id ?? undefined)
const categoryId = ref<number | undefined>(props.ticket?.category?.id ?? undefined)
const typeId = ref<number | undefined>(props.ticket?.type?.id ?? undefined)
const channelId = ref<number | undefined>(props.ticket?.channel?.id ?? undefined)
const priority = ref(props.ticket?.priority ?? 'medium')
const customerId = ref<number | null>(null)
const customerName = ref('')
const attempted = ref(false)
const failure = ref<string | null>(null)

const priorityItems = computed(() => (['low', 'medium', 'high', 'urgent'] as const)
  .map(value => ({ value, label: t(`helpdesk.priority.${value}`) })))
const teamItems = computed(() => (reference.data.value?.teams ?? []).map(team => ({ value: team.id, label: team.name })))
const categoryItems = computed(() => (reference.data.value?.categories ?? []).map(row => ({ value: row.id, label: row.name })))
const typeItems = computed(() => (reference.data.value?.types ?? []).map(row => ({ value: row.id, label: row.name })))
const channelItems = computed(() => (reference.data.value?.channels ?? []).map(row => ({ value: row.id, label: row.name })))

// Immediate: the panel opens over the list, which has already loaded the reference, so no later change would fire.
watch(() => reference.data.value, (value) => {
  if (editing.value || !value) return
  teamId.value ??= value.teams[0]?.id
}, { immediate: true })
const canPickCustomer = computed(() => props.forCustomer ?? can('helpdesk.tickets.write'))
const errors = computed(() => ({
  subject: attempted.value && !subject.value.trim(),
  description: attempted.value && !description.value.trim(),
  team: attempted.value && !teamId.value,
}))

function customerChosen(customer: { id: number; name: string } | null) {
  customerName.value = customer?.name ?? ''
}

async function submit() {
  attempted.value = true
  failure.value = null
  if (errors.value.subject || errors.value.description || errors.value.team) return
  try {
    const body: HelpdeskTicketCreate = {
      subject: subject.value.trim(),
      description: description.value.trim(),
      priority: priority.value as HelpdeskTicketCreate['priority'],
      ...(teamId.value ? { team_id: teamId.value } : {}),
      ...(categoryId.value ? { category_id: categoryId.value } : {}),
      ...(typeId.value ? { type_id: typeId.value } : {}),
      ...(channelId.value ? { channel_id: channelId.value } : {}),
      ...(customerId.value ? { customer_id: customerId.value } : {}),
    }
    const saved = editing.value
      ? await patch.mutateAsync({ id: props.ticket!.id, body })
      : await create.mutateAsync(body)
    emit('saved', saved)
    if (editing.value) await router.push(props.backTo)
  } catch (cause) {
    failure.value = cause instanceof Error ? cause.message : t('helpdesk.form.failed')
  }
}
const saveLabel = computed(() => editing.value ? t('helpdesk.form.save') : t('helpdesk.form.create'))
</script>

<template>
  <form class="flex flex-col gap-5" novalidate data-testid="helpdesk-form" @submit.prevent="submit">
    <UFormField :label="t('helpdesk.form.subject')" name="helpdesk-subject" required :error="errors.subject ? t('helpdesk.form.subjectRequired') : undefined">
      <UInput v-model="subject" class="w-full" :maxlength="200" :disabled="off" data-testid="helpdesk-subject" />
    </UFormField>
    <UFormField :label="t('helpdesk.form.description')" name="helpdesk-description" required :error="errors.description ? t('helpdesk.form.descriptionRequired') : undefined">
      <UTextarea v-model="description" class="w-full" :rows="6" :disabled="off" data-testid="helpdesk-description" />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField :label="t('helpdesk.form.team')" name="helpdesk-team" required :error="errors.team ? t('helpdesk.form.teamRequired') : undefined">
        <USelect v-model="teamId" class="w-full" :items="teamItems" :disabled="off" data-testid="helpdesk-team-select" />
      </UFormField>
      <UFormField :label="t('helpdesk.form.priority')" name="helpdesk-priority">
        <USelect v-model="priority" class="w-full" :items="priorityItems" :disabled="off" data-testid="helpdesk-priority-select" />
      </UFormField>
      <UFormField :label="t('helpdesk.form.category')" name="helpdesk-category">
        <USelect v-model="categoryId" class="w-full" :items="categoryItems" :placeholder="t('helpdesk.form.none')" :disabled="off" data-testid="helpdesk-category" />
      </UFormField>
      <UFormField v-if="can('helpdesk.tickets.read')" :label="t('helpdesk.form.type')" name="helpdesk-type">
        <USelect v-model="typeId" class="w-full" :items="typeItems" :placeholder="t('helpdesk.form.none')" :disabled="off" data-testid="helpdesk-type" />
      </UFormField>
      <UFormField :label="t('helpdesk.form.channel')" name="helpdesk-channel">
        <USelect v-model="channelId" class="w-full" :items="channelItems" :placeholder="t('helpdesk.form.none')" :disabled="off" data-testid="helpdesk-channel" />
      </UFormField>
    </div>
    <UFormField v-if="canPickCustomer && !editing" :label="t('helpdesk.form.customer')" name="helpdesk-customer" :help="t('helpdesk.form.customerHelp')">
      <SharedCustomerPicker
        v-model="customerId"
        :selected="customerId ? { id: customerId, name: customerName } : null"
        :disabled="off"
        :aria-label="t('helpdesk.form.customer')"
        @resolve="customerChosen"
      />
    </UFormField>
    <p v-if="failure" class="text-sm text-error" role="alert" data-testid="helpdesk-form-error">{{ failure }}</p>
    <div class="flex items-center justify-end gap-2">
      <UButton color="neutral" variant="outline" :label="t('app.cancel')" :disabled="off" @click="router.push(backTo)" />
      <UButton type="submit" :loading="off" :label="saveLabel" data-testid="helpdesk-save" />
    </div>
  </form>
</template>
