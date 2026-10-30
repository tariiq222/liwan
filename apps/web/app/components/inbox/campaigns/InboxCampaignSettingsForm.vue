<script setup lang="ts">
import { InboxCampaignSettingsPatchSchema, InboxConsentPolicySchema, type InboxCampaignSettings } from '@liwan/contracts'
import { useInboxCampaignSettings, useUpdateInboxCampaignSettings } from '@/composables/inbox/useInboxCampaigns'

// The company's campaign policy: who a campaign may message (only recorded opt-ins, or everyone who has not opted out), how
// local numbers of an import become international ones, the words that stop or resume marketing and the confirmation sent
// back, and the daily cap a new campaign starts with. It applies to the next campaign snapshot, never to messages already sent.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { data, isLoading, error, refetch } = useInboxCampaignSettings()
const { mutate: save, isPending } = useUpdateInboxCampaignSettings()

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
const draft = reactive<Draft>({
  consentPolicy: 'opted_in_only', countryCode: '', keywordOptOut: true, stopKeywords: [], startKeywords: [],
  stopReplyOn: false, stopReply: '', startReplyOn: false, startReply: '', dailyCap: 0,
})
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
watch(data, (settings) => { if (settings) Object.assign(draft, toDraft(settings)) }, { immediate: true })

const dirty = computed(() => !!data.value && JSON.stringify(write(draft)) !== JSON.stringify(data.value))
const valid = computed(() => InboxCampaignSettingsPatchSchema.safeParse(write(draft)).success)
const policyItems = computed(() => InboxConsentPolicySchema.options.map(value => ({ value, label: t(`inbox.campaigns.settings.policy.${value}`), description: t(`inbox.campaigns.settings.policyHint.${value}`) })))
const digits = (value: string) => value.replace(/\D/g, '').slice(0, 3)

function submit() {
  if (!hydrated.value || !dirty.value || !valid.value) return
  save(write(draft), {
    onSuccess: () => toast.add({ title: t('inbox.settings.saved'), color: 'success' }),
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedFormSection id="campaigns" panel class="liwan-settings-anchor" :title="t('inbox.campaigns.settings.title')" :description="t('inbox.campaigns.settings.hint')">
    <SharedLoadingSkeleton v-if="isLoading" />
    <SharedPageState v-else-if="error" :error="error" @retry="refetch()" />
    <form v-else class="flex flex-col gap-5" novalidate data-testid="inbox-campaign-settings" @submit.prevent="submit">
      <SharedUnsavedChanges :dirty="dirty" />
      <UFormField :label="t('inbox.campaigns.settings.policyLabel')" :description="t('inbox.campaigns.settings.policyDescription')">
        <URadioGroup v-model="draft.consentPolicy" :items="policyItems" :disabled="!hydrated || isPending" data-testid="inbox-consent-policy" />
      </UFormField>
      <UFormField :label="t('inbox.campaigns.settings.countryCode')" :description="t('inbox.campaigns.settings.countryCodeHint')">
        <UInput :model-value="draft.countryCode" class="w-full sm:w-40" dir="ltr" inputmode="numeric" maxlength="3" placeholder="966" :disabled="!hydrated || isPending" data-testid="inbox-country-code" @update:model-value="draft.countryCode = digits(String($event ?? ''))" />
      </UFormField>
      <label class="flex items-start gap-3 text-sm">
        <USwitch v-model="draft.keywordOptOut" class="mt-0.5" :disabled="!hydrated || isPending" data-testid="inbox-keyword-opt-out" />
        <span><span class="block font-medium text-highlighted">{{ t('inbox.campaigns.settings.keywordOptOut') }}</span><span class="block text-xs text-muted">{{ t('inbox.campaigns.settings.keywordOptOutHint') }}</span></span>
      </label>
      <template v-if="draft.keywordOptOut">
        <UFormField :label="t('inbox.campaigns.settings.stopKeywords')" :description="t('inbox.campaigns.settings.stopKeywordsHint')">
          <UInputTags v-model="draft.stopKeywords" class="w-full" :max-length="64" :disabled="!hydrated || isPending" :aria-label="t('inbox.campaigns.settings.stopKeywords')" data-testid="inbox-stop-keywords" />
        </UFormField>
        <UFormField :label="t('inbox.campaigns.settings.startKeywords')" :description="t('inbox.campaigns.settings.startKeywordsHint')">
          <UInputTags v-model="draft.startKeywords" class="w-full" :max-length="64" :disabled="!hydrated || isPending" :aria-label="t('inbox.campaigns.settings.startKeywords')" data-testid="inbox-start-keywords" />
        </UFormField>
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-3 text-sm font-medium text-highlighted"><USwitch v-model="draft.stopReplyOn" :disabled="!hydrated || isPending" />{{ t('inbox.campaigns.settings.stopReply') }}</label>
          <UTextarea v-if="draft.stopReplyOn" v-model="draft.stopReply" class="w-full" :rows="2" autoresize :maxlength="1024" :disabled="!hydrated || isPending" :aria-label="t('inbox.campaigns.settings.stopReply')" data-testid="inbox-stop-reply" />
        </div>
        <div class="flex flex-col gap-2">
          <label class="flex items-center gap-3 text-sm font-medium text-highlighted"><USwitch v-model="draft.startReplyOn" :disabled="!hydrated || isPending" />{{ t('inbox.campaigns.settings.startReply') }}</label>
          <UTextarea v-if="draft.startReplyOn" v-model="draft.startReply" class="w-full" :rows="2" autoresize :maxlength="1024" :disabled="!hydrated || isPending" :aria-label="t('inbox.campaigns.settings.startReply')" data-testid="inbox-start-reply" />
        </div>
      </template>
      <UFormField :label="t('inbox.campaigns.settings.dailyCap')" :description="t('inbox.campaigns.settings.dailyCapHint')">
        <UInputNumber v-model="draft.dailyCap" class="w-full sm:w-60" :min="0" :max="1000000" :disabled="!hydrated || isPending" data-testid="inbox-default-cap" />
      </UFormField>
      <div class="flex justify-end">
        <UButton type="submit" :disabled="!hydrated || !dirty || !valid" :loading="isPending" :label="t('app.save')" data-testid="inbox-campaign-settings-save" />
      </div>
    </form>
  </SharedFormSection>
</template>
