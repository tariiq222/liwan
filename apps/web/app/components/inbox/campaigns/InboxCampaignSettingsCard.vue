<script setup lang="ts">
import { InboxCampaignSettingsPatchSchema, InboxConsentPolicySchema, type InboxCampaignSettings } from '@liwan/contracts'
import { ApiError } from '@/composables/useApi'
import { useUpdateInboxCampaignSettings } from '@/composables/inbox/useInboxCampaigns'
import { useSettingsForm } from '@/composables/settings/useSettingsForm'

// The company's campaign policy: who a campaign may message (only recorded opt-ins, or everyone who has not opted out), how
// local numbers of an import become international ones, the words that stop or resume marketing and the confirmation sent
// back, and the daily cap a new campaign starts with. It applies to the next campaign snapshot, never to messages already sent.
// The card saves through the settings page's one save bar.
const props = defineProps<{ settings: InboxCampaignSettings; canEdit: boolean; reloadSettings: () => Promise<InboxCampaignSettings> }>()
const { t } = useI18n()
const hydrated = useHydrated()
const { mutateAsync: saveSettings } = useUpdateInboxCampaignSettings()

interface Draft {
  consentPolicy: InboxCampaignSettings['consent_policy']
  countryCode: string
  keywordOptOut: boolean
  stopKeywords: string[]
  startKeywords: string[]
  stopReplyOn: boolean
  stopReply: string
  startReplyOn: boolean
  startReply: string
  dailyCap: number
}
const toDraft = (settings: InboxCampaignSettings): Draft => ({
  consentPolicy: settings.consent_policy, countryCode: settings.default_country_code ?? '', keywordOptOut: settings.keyword_opt_out,
  stopKeywords: [...settings.stop_keywords], startKeywords: [...settings.start_keywords],
  stopReplyOn: settings.stop_reply !== null, stopReply: settings.stop_reply ?? '',
  startReplyOn: settings.start_reply !== null, startReply: settings.start_reply ?? '', dailyCap: settings.default_daily_cap,
})
const write = (value: Draft): InboxCampaignSettings => ({
  consent_policy: value.consentPolicy,
  default_country_code: value.countryCode.trim() || null,
  keyword_opt_out: value.keywordOptOut,
  stop_keywords: value.stopKeywords.map(word => word.trim()).filter(Boolean),
  start_keywords: value.startKeywords.map(word => word.trim()).filter(Boolean),
  stop_reply: value.stopReplyOn ? value.stopReply.trim() : null,
  start_reply: value.startReplyOn ? value.startReply.trim() : null,
  default_daily_cap: Math.max(0, Math.round(value.dailyCap || 0)),
})

const { draft, state, save, revert, reload } = useSettingsForm<InboxCampaignSettings, Draft>({
  source: () => props.settings,
  read: toDraft,
  save: (values) => {
    const body = write(values)
    if (!InboxCampaignSettingsPatchSchema.safeParse(body).success) throw new ApiError(422, 'invalid', t('errors.generic'))
    return saveSettings(body)
  },
  reload: () => props.reloadSettings(),
})
const locked = computed(() => !hydrated.value || !props.canEdit || state.value.saving || state.value.reloading)
const policyItems = computed(() => InboxConsentPolicySchema.options.map(value => ({ value, label: t(`inbox.campaigns.settings.policy.${value}`), description: t(`inbox.campaigns.settings.policyHint.${value}`) })))
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 3)
</script>

<template>
  <SharedSettingsCard id="campaigns" v-bind="state" :title="t('inbox.campaigns.settings.title')" :description="t('inbox.campaigns.settings.hint')" :can-edit="canEdit" data-testid="inbox-campaign-settings" @save="save" @revert="revert" @reload="reload">
    <SharedSettingRow stacked :label="t('inbox.campaigns.settings.policyLabel')" :description="t('inbox.campaigns.settings.policyDescription')">
      <SharedOptionCards v-model="draft.consentPolicy" :options="policyItems" :label="t('inbox.campaigns.settings.policyLabel')" :disabled="locked" data-testid="inbox-consent-policy" />
    </SharedSettingRow>
    <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
      <UFormField :label="t('inbox.campaigns.settings.countryCode')" name="inbox-country-code" :help="t('inbox.campaigns.settings.countryCodeHint')">
        <UInput id="inbox-country-code" :model-value="draft.countryCode" class="w-full" dir="ltr" inputmode="numeric" maxlength="3" placeholder="966" :disabled="locked" data-testid="inbox-country-code" @update:model-value="draft.countryCode = digits(String($event ?? ''))" />
      </UFormField>
      <UFormField :label="t('inbox.campaigns.settings.dailyCap')" name="inbox-default-cap" :help="t('inbox.campaigns.settings.dailyCapHint')">
        <UInputNumber id="inbox-default-cap" v-model="draft.dailyCap" class="w-full" :min="0" :max="1000000" :disabled="locked" data-testid="inbox-default-cap" />
      </UFormField>
    </div>
    <SharedSettingRow :label="t('inbox.campaigns.settings.keywordOptOut')" :description="t('inbox.campaigns.settings.keywordOptOutHint')">
      <USwitch v-model="draft.keywordOptOut" :aria-label="t('inbox.campaigns.settings.keywordOptOut')" :disabled="locked" data-testid="inbox-keyword-opt-out" />
    </SharedSettingRow>
    <template v-if="draft.keywordOptOut">
      <div class="liwan-auto-grid liwan-field-grid liwan-setting-fields">
        <UFormField :label="t('inbox.campaigns.settings.stopKeywords')" name="inbox-stop-keywords" :help="t('inbox.campaigns.settings.stopKeywordsHint')">
          <UInputTags id="inbox-stop-keywords" v-model="draft.stopKeywords" class="w-full" :max-length="64" :disabled="locked" :aria-label="t('inbox.campaigns.settings.stopKeywords')" data-testid="inbox-stop-keywords" />
        </UFormField>
        <UFormField :label="t('inbox.campaigns.settings.startKeywords')" name="inbox-start-keywords" :help="t('inbox.campaigns.settings.startKeywordsHint')">
          <UInputTags id="inbox-start-keywords" v-model="draft.startKeywords" class="w-full" :max-length="64" :disabled="locked" :aria-label="t('inbox.campaigns.settings.startKeywords')" data-testid="inbox-start-keywords" />
        </UFormField>
      </div>
      <SharedSettingRow :label="t('inbox.campaigns.settings.stopReply')">
        <USwitch v-model="draft.stopReplyOn" :aria-label="t('inbox.campaigns.settings.stopReply')" :disabled="locked" />
      </SharedSettingRow>
      <UFormField v-if="draft.stopReplyOn" :label="t('inbox.campaigns.settings.stopReply')" name="inbox-stop-reply">
        <UTextarea id="inbox-stop-reply" v-model="draft.stopReply" class="w-full" :rows="2" autoresize :maxlength="1024" :disabled="locked" data-testid="inbox-stop-reply" />
      </UFormField>
      <SharedSettingRow :label="t('inbox.campaigns.settings.startReply')">
        <USwitch v-model="draft.startReplyOn" :aria-label="t('inbox.campaigns.settings.startReply')" :disabled="locked" />
      </SharedSettingRow>
      <UFormField v-if="draft.startReplyOn" :label="t('inbox.campaigns.settings.startReply')" name="inbox-start-reply">
        <UTextarea id="inbox-start-reply" v-model="draft.startReply" class="w-full" :rows="2" autoresize :maxlength="1024" :disabled="locked" data-testid="inbox-start-reply" />
      </UFormField>
    </template>
  </SharedSettingsCard>
</template>
