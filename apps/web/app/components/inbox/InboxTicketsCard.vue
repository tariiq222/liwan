<script setup lang="ts">
import { useConversationTickets, useCreateConversationTicket, useInboxTicketsAccess } from '@/composables/useInboxTickets'

// Both applications' permissions apply to the tickets raised from this conversation. One ticket stays open at a time.
const props = defineProps<{ conversationId: number }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const access = useInboxTicketsAccess()
const list = useConversationTickets(() => props.conversationId, access.read)
const create = useCreateConversationTicket()
const refused = computed(() => (list.error.value as { status?: number } | null)?.status === 403)
const visible = computed(() => access.read.value && !refused.value && list.isSuccess.value)
const items = computed(() => list.data.value?.items ?? [])
const hasOpen = computed(() => items.value.some(ticket => !ticket.stage.closed))
const raising = ref(false)
const subject = ref('')
const failure = ref('')
const locked = computed(() => !hydrated.value || create.isPending.value)

function close() {
  raising.value = false
  subject.value = ''
}

async function raise() {
  const text = subject.value.trim()
  if (!text) return
  failure.value = ''
  const conversationId = props.conversationId
  try {
    await create.mutateAsync({ conversationId, body: { subject: text } })
    close()
    toast.add({ title: t('inbox.tickets.created'), color: 'success' })
  } catch (error) {
    if (conversationId !== props.conversationId) return
    const failed = (error ?? {}) as { status?: number; details?: { reason?: string } }
    if (failed.status === 409 && failed.details?.reason === 'open_ticket_exists') {
      close()
      failure.value = t('inbox.tickets.openExists')
    } else {
      failure.value = failed.status === 403 ? t('errors.forbidden') : t('errors.generic')
    }
  }
}
</script>

<template>
  <SharedRecordSection v-if="visible" variant="panel" :title="t('inbox.tickets.title')" data-testid="inbox-tickets">
    <div class="grid gap-3 text-sm">
      <ul v-if="items.length" class="grid gap-2" data-testid="inbox-tickets-list">
        <li v-for="ticket in items" :key="ticket.id" class="grid gap-1">
          <NuxtLink :to="`/helpdesk/${ticket.id}`" class="min-w-0 truncate font-semibold text-primary hover:underline">
            <bdi dir="ltr">{{ ticket.number }}</bdi> · {{ ticket.subject }}
          </NuxtLink>
          <SharedStatusBadge :tone="ticket.stage.closed ? 'neutral' : 'info'" :label="ticket.stage.name" size="sm" class="justify-self-start" />
        </li>
      </ul>
      <p v-else class="text-muted" data-testid="inbox-tickets-none">{{ t('inbox.tickets.none') }}</p>
      <UButton v-if="access.create.value && !hasOpen && !raising" class="justify-self-start" size="xs" icon="i-lucide-plus" :label="t('inbox.tickets.raise')" :disabled="locked" data-testid="inbox-tickets-raise" @click="raising = true" />
      <form v-if="raising" class="grid gap-3" data-testid="inbox-tickets-form" @submit.prevent="raise">
        <UFormField :label="t('inbox.tickets.subject')" required>
          <UInput v-model="subject" class="w-full" maxlength="200" :disabled="locked" data-testid="inbox-tickets-subject" />
        </UFormField>
        <div class="flex justify-end gap-2">
          <UButton type="button" color="neutral" variant="outline" size="sm" :label="t('app.cancel')" :disabled="locked" @click="close" />
          <UButton type="submit" size="sm" :label="t('inbox.tickets.confirm')" :loading="create.isPending.value" :disabled="locked || !subject.trim()" data-testid="inbox-tickets-confirm" />
        </div>
      </form>
      <UAlert v-if="failure" role="alert" color="error" variant="subtle" :description="failure" data-testid="inbox-tickets-error" />
    </div>
  </SharedRecordSection>
</template>
