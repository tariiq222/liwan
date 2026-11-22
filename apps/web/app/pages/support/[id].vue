<script setup lang="ts">
import { formatDate } from '@liwan/ui/app/utils/formatDate'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { HelpdeskPortalTicketSchema } from '@liwan/contracts'

// The page an invited customer opens from their ticket link: no account, no session. The token in the address is the
// only credential. They read the thread, answer it, or close the ticket; every refusal is the same "link not usable".
definePageMeta({ layout: false, access: 'public' })

const route = useRoute()
const { t } = useI18n()
const { $api } = useApi()
const hydrated = useHydrated()
const ticketId = computed(() => Number(route.params.id))
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const path = computed(() => `/api/v1/public/helpdesk/tickets/${ticketId.value}`)
const enabled = computed(() => hydrated.value && Number.isInteger(ticketId.value) && ticketId.value > 0 && Boolean(token.value))

const page = useQuery({
  queryKey: computed(() => ['helpdesk', 'portal', ticketId.value, token.value] as const),
  enabled,
  retry: false,
  queryFn: () => $api(path.value, { query: { token: token.value }, schema: HelpdeskPortalTicketSchema }),
})
const body = ref('')
const failure = ref<string | null>(null)
const busy = computed(() => reply.isPending.value || close.isPending.value)
const reply = useMutation({
  mutationFn: (text: string) => $api(`${path.value}/messages`, {
    method: 'POST', query: { token: token.value }, body: { body: text }, schema: HelpdeskPortalTicketSchema,
  }),
  onSuccess: async () => {
    body.value = ''
    await page.refetch()
  },
})
const close = useMutation({
  mutationFn: () => $api(`${path.value}/close`, {
    method: 'POST', query: { token: token.value }, body: {}, schema: HelpdeskPortalTicketSchema,
  }),
  onSuccess: async () => {
    await page.refetch()
  },
})
const data = computed(() => page.data.value ?? null)
// A link with no token, or with a malformed ticket id, never asks the server (there is nothing to ask with), so it
// is invalid on its own: without this the query stayed disabled and the page rendered nothing at all.
const invalidLink = computed(() => !token.value || !Number.isInteger(ticketId.value) || ticketId.value <= 0 || page.isError.value)
const confirming = ref(false)

async function send() {
  const text = body.value.trim()
  if (!text || busy.value) return
  failure.value = null
  try {
    await reply.mutateAsync(text)
  } catch {
    // A customer without an account never sees an internal refusal («your session expired», «the subscription is
    // read-only»): those belong to the tenant, so the portal answers with one neutral line whatever came back.
    failure.value = t('helpdesk.portal.failed')
  }
}
async function closeTicket() {
  failure.value = null
  try {
    await close.mutateAsync()
    confirming.value = false
  } catch {
    // A customer without an account never sees an internal refusal («your session expired», «the subscription is
    // read-only»): those belong to the tenant, so the portal answers with one neutral line whatever came back.
    failure.value = t('helpdesk.portal.failed')
  }
}
</script>

<template>
  <SharedStandalonePage data-testid="helpdesk-portal">
    <template #header>
      <div class="flex min-w-0 items-center gap-3">
        <span class="liwan-app-tile" aria-hidden="true"><UIcon name="i-lucide-life-buoy" /></span>
        <div class="min-w-0">
          <p class="truncate text-base font-semibold text-highlighted">{{ data?.company.name ?? t('helpdesk.portal.title') }}</p>
          <p class="text-sm text-muted">{{ t('helpdesk.portal.subtitle') }}</p>
        </div>
      </div>
    </template>
    <SharedPageState v-if="!hydrated || (enabled && page.isLoading.value)" :loading="true" />
    <SharedEmptyState v-else-if="invalidLink" :title="t('helpdesk.portal.invalidTitle')" :description="t('helpdesk.portal.invalid')" data-testid="helpdesk-portal-invalid" />
    <template v-else-if="data">
      <SharedPageHeader :title="`${data.number} · ${data.subject}`">
        <template #tags>
          <SharedStatusBadge :tone="data.stage.closed ? 'neutral' : 'info'" :label="data.stage.name" />
        </template>
      </SharedPageHeader>
      <SharedRecordSection variant="panel" :title="t('helpdesk.portal.request')">
        <SharedRichText :html="data.description" />
        <p class="mt-2 text-sm text-muted"><bdi dir="ltr">{{ formatDate(data.created_at) }}</bdi></p>
      </SharedRecordSection>
      <SharedRecordSection variant="panel" :title="t('helpdesk.portal.conversation')" data-testid="helpdesk-portal-thread">
        <SharedEmptyState v-if="!data.messages.length" :title="t('helpdesk.portal.noReplies')" />
        <ul v-else class="flex flex-col gap-3">
          <li v-for="message in data.messages" :key="message.id" class="rounded-control border border-default px-3 py-2">
            <p class="text-sm text-muted">{{ message.author }} · <bdi dir="ltr">{{ formatDate(message.created_at) }}</bdi></p>
            <SharedRichText :html="message.body" size="sm" />
          </li>
        </ul>
        <div v-if="data.actions.reply" class="mt-4 flex flex-col gap-2">
          <UTextarea v-model="body" class="w-full" :rows="3" :maxlength="5000" :disabled="busy" :placeholder="t('helpdesk.portal.placeholder')" data-testid="helpdesk-portal-reply" />
          <UButton class="self-end" :loading="reply.isPending.value" :disabled="!body.trim()" :label="t('helpdesk.portal.send')" data-testid="helpdesk-portal-send" @click="send" />
        </div>
      </SharedRecordSection>
      <p v-if="failure" class="mt-2 text-sm text-error" role="alert" data-testid="helpdesk-portal-error">{{ failure }}</p>
      <div v-if="data.actions.close" class="mt-4">
        <SharedInlineConfirm
          v-if="confirming"
          :title="t('helpdesk.portal.closeConfirm')"
          :confirm-label="t('helpdesk.portal.close')"
          :cancel-label="t('app.cancel')"
          :pending="close.isPending.value"
          color="primary"
          @confirm="closeTicket"
          @cancel="confirming = false"
        />
        <UButton v-else color="neutral" variant="outline" icon="i-lucide-check" :label="t('helpdesk.portal.close')" data-testid="helpdesk-portal-close" @click="confirming = true" />
      </div>
    </template>
    <!-- Between a finished query and its data (query-core's `isPending && !isFetching` window) every branch above is
         false, and the portal drew nothing at all. It keeps the loading state rather than an empty page. -->
    <SharedPageState v-else :loading="true" />
  </SharedStandalonePage>
</template>
