<script setup lang="ts">
import { InboxContactMarketingPatchSchema } from '@liwan/contracts'
import { formatDateTime } from '@liwan/ui/app/utils/formatDate'
import { CONSENT_TONE } from '@/composables/inbox/inboxCampaignPresentation'
import { useInboxTags } from '@/composables/inbox/useInbox'
import { useInboxContactMarketing, usePatchInboxContactMarketing } from '@/composables/inbox/useInboxCampaigns'

// The marketing side of one contact: the consent state with its history (who, when, where it came from), recording an
// opt-in with its proof or an opt-out, and the customer segments (tags) that audiences select on. Reading is open to
// whoever can read the conversation; changing needs the reply capability.
const props = defineProps<{ contactId: number; canWrite: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxContactMarketing(() => props.contactId)
const { mutate: patch, isPending } = usePatchInboxContactMarketing(() => props.contactId)
const tags = useInboxTags()
const marketing = query.data
const proof = ref('')
const asking = ref<'opt_in' | 'opt_out' | null>(null)
const off = computed(() => !hydrated.value || isPending.value || !props.canWrite)
const tagIds = computed(() => marketing.value?.tags.map(tag => tag.id) ?? [])
const tagItems = computed(() => tags.data.value?.items ?? marketing.value?.tags ?? [])
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function save(body: unknown, after?: () => void) {
  const parsed = InboxContactMarketingPatchSchema.safeParse(body)
  if (!parsed.success) return
  patch(parsed.data, { onSuccess: () => { after?.(); toast.add({ title: t('inbox.settings.saved'), color: 'success' }) }, onError: fail })
}
const done = () => { asking.value = null; proof.value = '' }
const optIn = () => save({ consent: { state: 'opted_in', note: proof.value.trim() } }, done)
const optOut = () => save({ consent: { state: 'opted_out' } }, done)
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.campaigns.marketing.title')" data-testid="inbox-contact-marketing">
    <SharedLoadingSkeleton v-if="query.isPending.value" />
    <SharedPageState v-else-if="query.error.value" :error="query.error.value" @retry="query.refetch()" />
    <div v-else-if="marketing" class="flex flex-col gap-3">
      <div class="flex flex-wrap items-center gap-2">
        <SharedStatusBadge :tone="CONSENT_TONE[marketing.consent]" :label="t(`inbox.campaigns.consent.${marketing.consent}`)" data-testid="inbox-consent-badge" />
        <span v-if="marketing.consent_at && marketing.consent_source" class="text-xs text-muted">{{ t('inbox.campaigns.marketing.since', { source: t(`inbox.campaigns.marketing.source.${marketing.consent_source}`), time: formatDateTime(marketing.consent_at) }) }}</span>
      </div>

      <div v-if="props.canWrite" class="flex flex-wrap gap-2">
        <UButton v-if="marketing.consent !== 'opted_in'" type="button" size="xs" color="neutral" variant="outline" icon="i-lucide-bell-ring" :disabled="off" :label="t('inbox.campaigns.marketing.recordOptIn')" data-testid="inbox-consent-opt-in" @click="asking = 'opt_in'" />
        <UButton v-if="marketing.consent !== 'opted_out'" type="button" size="xs" color="neutral" variant="outline" icon="i-lucide-bell-off" :disabled="off" :label="t('inbox.campaigns.marketing.recordOptOut')" data-testid="inbox-consent-opt-out" @click="asking = 'opt_out'" />
      </div>
      <form v-if="asking === 'opt_in'" class="flex flex-col gap-2" novalidate @submit.prevent="optIn">
        <UFormField :label="t('inbox.campaigns.marketing.proof')" :description="t('inbox.campaigns.marketing.proofHint')" required>
          <UInput v-model="proof" class="w-full" maxlength="256" :disabled="off" data-testid="inbox-consent-proof" />
        </UFormField>
        <div class="flex gap-2">
          <UButton type="submit" size="xs" :disabled="off || !proof.trim()" :loading="isPending" :label="t('inbox.campaigns.marketing.recordOptIn')" data-testid="inbox-consent-opt-in-save" />
          <UButton type="button" size="xs" color="neutral" variant="ghost" :disabled="off" :label="t('app.cancel')" @click="done" />
        </div>
      </form>
      <SharedInlineConfirm
        v-else-if="asking === 'opt_out'" color="warning" :title="t('inbox.campaigns.marketing.optOutTitle')" :description="t('inbox.campaigns.marketing.optOutDescription')"
        :confirm-label="t('inbox.campaigns.marketing.recordOptOut')" :pending="isPending" @confirm="optOut" @cancel="done"
      />

      <UFormField :label="t('inbox.campaigns.marketing.tags')" :description="t('inbox.campaigns.marketing.tagsHint')">
        <USelectMenu
          :model-value="tagIds" multiple value-key="id" label-key="name" :items="tagItems" class="w-full" :disabled="off" :placeholder="t('inbox.panel.noTags')" :aria-label="t('inbox.campaigns.marketing.tags')" data-testid="inbox-contact-segments"
          @update:model-value="save({ tag_ids: $event as number[] })"
        />
      </UFormField>

      <details v-if="marketing.history.length" class="text-sm" data-testid="inbox-consent-history">
        <summary class="cursor-pointer font-medium text-highlighted">{{ t('inbox.campaigns.marketing.history') }}</summary>
        <ol class="mt-2 flex flex-col gap-2">
          <li v-for="(event, index) in marketing.history" :key="index" class="flex flex-col rounded-control bg-elevated/60 px-2 py-1.5">
            <span class="flex flex-wrap items-center gap-1.5"><SharedStatusBadge size="sm" :tone="CONSENT_TONE[event.state]" :label="t(`inbox.campaigns.consent.${event.state}`)" /><span class="text-xs text-muted">{{ t(`inbox.campaigns.marketing.source.${event.source}`) }}<template v-if="event.author"> · {{ event.author.name }}</template> · {{ formatDateTime(event.at) }}</span></span>
            <span v-if="event.note" class="mt-0.5 break-words text-xs">{{ event.note }}</span>
          </li>
        </ol>
      </details>
    </div>
  </SharedRecordSection>
</template>
