<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import { statusTag } from '@liwan/ui/app/utils/pageHeaderTag'
import InboxChannelSending from '@/components/inbox/campaigns/InboxChannelSending.vue'
import InboxCampaignActions from '@/components/inbox/campaigns/InboxCampaignActions.vue'
import InboxCampaignForm from '@/components/inbox/campaigns/InboxCampaignForm.vue'
import InboxCampaignRecipients from '@/components/inbox/campaigns/InboxCampaignRecipients.vue'
import InboxCampaignStats from '@/components/inbox/campaigns/InboxCampaignStats.vue'
import InboxCampaignTestSend from '@/components/inbox/campaigns/InboxCampaignTestSend.vue'
import { CAMPAIGN_STATE_TONE, CONFIRMED_ACTIONS, type CampaignAction } from '@/composables/inbox/inboxCampaignPresentation'
import { useDeleteInboxCampaign, useInboxCampaign, useInboxCampaignAction } from '@/composables/inbox/useInboxCampaigns'

// One campaign: its live figures (refetched every 10 seconds while it is scheduled or running), the state actions, the
// sending budget, a test send, the recipients and the edit form while the campaign can still be changed. Launch, cancel and
// delete are confirmed inline first.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { can } = useAccess()
const id = computed(() => {
  const value = Number(route.params.campaignId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const query = useInboxCampaign(id)
const campaign = query.data
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/inbox/campaigns', ['/inbox/campaigns']))
const { mutate: run, isPending: running } = useInboxCampaignAction(() => id.value ?? 0)
const { mutate: remove, isPending: removing } = useDeleteInboxCampaign()
const canOpenConversation = computed(() => can('inbox.conversations.read'))

const confirming = ref<CampaignAction | 'delete' | null>(null)
const editVersion = ref(0)
const busy = computed(() => running.value || removing.value)
const fail = (e: unknown) => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })

function execute(action: CampaignAction) {
  run(action, {
    onSuccess: () => {
      confirming.value = null
      toast.add({ title: t(`inbox.campaigns.actions.${action}Done`), color: 'success' })
    },
    onError: fail,
  })
}
function ask(action: CampaignAction) {
  if (CONFIRMED_ACTIONS.includes(action)) confirming.value = action
  else execute(action)
}
function confirmAction() {
  if (confirming.value === 'delete') {
    remove(id.value!, { onSuccess: () => navigateTo(backTo.value), onError: fail })
  } else if (confirming.value) {
    execute(confirming.value)
  }
}

const tags = computed(() => {
  const value = campaign.value
  if (!value) return []
  return [
    statusTag({ tone: CAMPAIGN_STATE_TONE[value.state], label: t(`inbox.campaigns.states.${value.state}`) }, 'inbox-campaign-state'),
    { label: value.channel.name, kind: 'category' as const, icon: 'i-lucide-plug-zap' },
    ...(value.template ? [{ label: `${value.template.name} · ${t(`inbox.templates.category.${value.template.category}`)}`, kind: 'category' as const }] : []),
    { label: value.audience.name, kind: 'count' as const, icon: 'i-lucide-users-round' },
  ]
})
const showRecipients = computed(() => !!campaign.value && campaign.value.state !== 'draft')
const showTest = computed(() => !!campaign.value && ['draft', 'scheduled', 'paused'].includes(campaign.value.state) && !!campaign.value.template)
</script>

<template>
  <SharedRecordPage
    :title="campaign?.name ?? t('inbox.campaigns.title')"
    :tags="tags"
    :back-to="backTo"
    :back-label="t('inbox.campaigns.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="campaign" #actions>
      <InboxCampaignActions :campaign="campaign" :busy="busy" @action="ask" @remove="confirming = 'delete'" />
    </template>

    <template v-if="campaign">
      <SharedInlineConfirm
        v-if="confirming"
        :title="t(`inbox.campaigns.confirm.${confirming}Title`, { name: campaign.name })"
        :description="t(`inbox.campaigns.confirm.${confirming}Description`)"
        :confirm-label="t(confirming === 'delete' ? 'inbox.settings.delete' : `inbox.campaigns.actions.${confirming}`)"
        :color="confirming === 'launch' ? 'primary' : 'error'"
        :pending="busy"
        data-testid="inbox-campaign-confirm"
        @confirm="confirmAction"
        @cancel="confirming = null"
      />
      <InboxCampaignStats :campaign="campaign" />
      <InboxChannelSending :channel-id="campaign.channel.id" :can-edit="false" show-health />
      <InboxCampaignTestSend v-if="showTest" :campaign="campaign" :can-open-conversation="canOpenConversation" />
      <InboxCampaignRecipients v-if="showRecipients" :campaign-id="campaign.id" :poll="campaign.state === 'running' || campaign.state === 'scheduled'" :can-open-conversation="canOpenConversation" />
      <SharedRecordSection v-if="campaign.can_edit" variant="panel" :title="t('inbox.campaigns.edit')" :description="t('inbox.campaigns.editHint')">
        <InboxCampaignForm :key="`${campaign.id}-${editVersion}`" :campaign="campaign" :back-to="backTo" @saved="editVersion += 1" />
      </SharedRecordSection>
    </template>
  </SharedRecordPage>
</template>
