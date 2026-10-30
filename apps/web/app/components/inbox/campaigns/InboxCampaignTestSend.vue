<script setup lang="ts">
import type { InboxCampaign } from '@liwan/contracts'
import InboxCampaignContactPicker from '@/components/inbox/campaigns/InboxCampaignContactPicker.vue'
import { useTestInboxCampaign } from '@/composables/inbox/useInboxCampaigns'

// One real message to one chosen contact, before the campaign starts. The consent policy still applies, and the contact
// is not a recipient of the campaign.
const props = defineProps<{ campaign: InboxCampaign; canOpenConversation: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const contactId = ref<number | null>(null)
const { mutate: send, isPending, data: sent } = useTestInboxCampaign(() => props.campaign.id)

function submit() {
  if (!contactId.value || !hydrated.value || isPending.value) return
  send(contactId.value, {
    onSuccess: () => toast.add({ title: t('inbox.campaigns.test.sent'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.campaigns.test.title')" :description="t('inbox.campaigns.test.hint')" data-testid="inbox-campaign-test">
    <form class="flex flex-col gap-3 sm:flex-row sm:items-end" novalidate @submit.prevent="submit">
      <UFormField class="flex-1" :label="t('inbox.campaigns.test.contact')">
        <InboxCampaignContactPicker v-model="contactId" :audience-id="props.campaign.audience.id" :disabled="!hydrated || isPending" :placeholder="t('inbox.campaigns.test.placeholder')" :label="t('inbox.campaigns.test.contact')" />
      </UFormField>
      <UButton type="submit" color="neutral" variant="outline" icon="i-lucide-send" :loading="isPending" :disabled="!hydrated || !contactId" :label="t('inbox.campaigns.test.send')" data-testid="inbox-campaign-test-send" />
    </form>
    <UButton v-if="sent && props.canOpenConversation" :to="`/inbox/${sent.conversation_id}`" class="mt-2" color="neutral" variant="link" :label="t('inbox.campaigns.test.open')" />
  </SharedRecordSection>
</template>
