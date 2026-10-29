<script setup lang="ts">
import type { InboxCampaign } from '@webvue/contracts'
import { campaignActions, type CampaignAction } from '@/composables/inbox/inboxCampaignPresentation'

// The header buttons of a campaign, by state. They only ask: the page confirms launch, cancel and delete inline and sends
// the request, and the server decides whether an action is allowed.
const props = defineProps<{ campaign: InboxCampaign; busy?: boolean }>()
const emit = defineEmits<{ action: [action: CampaignAction]; remove: [] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const off = computed(() => !hydrated.value || props.busy)
const actions = computed(() => campaignActions(props.campaign))
const ICON: Record<CampaignAction, string> = {
  launch: 'i-lucide-rocket', pause: 'i-lucide-pause', resume: 'i-lucide-play', cancel: 'i-lucide-circle-x', retry: 'i-lucide-rotate-ccw',
}
const primary = (action: CampaignAction) => action === 'launch' || action === 'resume'
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <UButton
      v-for="action in actions" :key="action" type="button" :icon="ICON[action]"
      :color="action === 'cancel' ? 'error' : primary(action) ? 'primary' : 'neutral'" :variant="primary(action) ? 'solid' : 'outline'"
      :disabled="off" :label="t(`inbox.campaigns.actions.${action}`)" :data-testid="`inbox-campaign-${action}`" @click="emit('action', action)"
    />
    <UButton v-if="props.campaign.can_delete" type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="off" :label="t('inbox.settings.delete')" data-testid="inbox-campaign-delete" @click="emit('remove')" />
  </div>
</template>
