<script setup lang="ts">
import InboxAutoContentEditor from '@/components/inbox/InboxAutoContentEditor.vue'
import type { InboxChannelAutomation, InboxChannelKind } from '@liwan/contracts'
import { TIKTOK_SURVEY_QUESTION_MAX, TIKTOK_WELCOME_MAX, automationToDraft, automationWrite } from '@/composables/inbox/inboxAutomation'
import { useSaveInboxChannelAutomation } from '@/composables/inbox/useInboxAutomation'

// One channel's automatic messages: the welcome, the away message (outside working hours) and the satisfaction survey.
// Each is off by default. The welcome and away messages say text or an interactive menu; the survey asks the customer
// to pick good / neutral / bad after an agent resolves the conversation. On TikTok the welcome is a text of up to 250
// characters that TikTok sends itself, the away message is a text or a button card, and the survey is a card, so its
// question is a 40-character card title (D3, D10).
const props = withDefaults(defineProps<{ channelId: number; automation: InboxChannelAutomation; kind?: InboxChannelKind }>(), { kind: 'whatsapp' })
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutate: save, isPending } = useSaveInboxChannelAutomation(() => props.channelId)

// The draft starts from the stored automation (the same first frame on the server and the client) and starts again
// from the saved one after a save.
const draft = ref(automationToDraft(props.automation))
const initial = ref(JSON.stringify(draft.value))
watch(() => props.automation, (automation) => {
  draft.value = automationToDraft(automation)
  initial.value = JSON.stringify(draft.value)
})
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value)
const write = computed(() => automationWrite(draft.value, props.kind))
const tiktok = computed(() => props.kind === 'tiktok')
const csatQuestionMax = computed(() => (tiktok.value ? TIKTOK_SURVEY_QUESTION_MAX : 1024))
// TikTok sends the survey as a button card, so its question is that card's title: a stored question longer than the
// card title (the contract still accepts it) would be saved and then refused on every send, so it blocks the save.
const csatTooLong = computed(() => tiktok.value && draft.value.csat.question.trim().length > TIKTOK_SURVEY_QUESTION_MAX)
const WELCOME_TEXT_ONLY: readonly ('text' | 'interactive' | 'commerce')[] = ['text']
const attempted = ref(false)
const off = computed(() => !hydrated.value || isPending.value)
// An enabled message needs content: the same rule the contract states, shown next to the editor.
const missing = (kind: 'welcome' | 'away') => attempted.value && draft.value[kind].enabled && !write.value
const CSAT_SCORES = ['good', 'neutral', 'bad'] as const

function submit() {
  attempted.value = true
  if (off.value || !dirty.value || !write.value || csatTooLong.value) return
  save(write.value, {
    onSuccess: () => {
      attempted.value = false
      toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <form class="liwan-form" novalidate data-testid="inbox-automation-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />
    <UAlert v-if="tiktok" color="info" variant="subtle" icon="i-lucide-info" :title="t('inbox.automation.tiktok.title')" :description="t('inbox.automation.tiktok.hint')" data-testid="inbox-automation-tiktok" />

    <SharedRecordSection variant="panel" :title="t('inbox.automation.welcome.title')" :description="t('inbox.automation.welcome.hint')">
      <div class="flex flex-col gap-4">
        <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
          <USwitch v-model="draft.welcome.enabled" :disabled="off" data-testid="inbox-welcome-enabled" />{{ t('inbox.automation.enable') }}
        </label>
        <template v-if="draft.welcome.enabled">
          <UFormField :label="t('inbox.automation.welcome.idleDays')" :description="t('inbox.automation.welcome.idleDaysHint')">
            <UInputNumber v-model="draft.welcome.idleDays" class="w-40" :min="0" :max="365" :disabled="off" />
          </UFormField>
          <InboxAutoContentEditor
            v-model="draft.welcome.content"
            :label="t('inbox.automation.welcome.title')"
            :channel-id="props.channelId"
            :kind="props.kind"
            :allowed="tiktok ? WELCOME_TEXT_ONLY : undefined"
            :text-max="tiktok ? TIKTOK_WELCOME_MAX : undefined"
          />
          <p v-if="missing('welcome')" class="text-sm text-error" role="alert">{{ t('inbox.automation.contentRequired') }}</p>
        </template>
      </div>
    </SharedRecordSection>

    <SharedRecordSection variant="panel" :title="t('inbox.automation.away.title')" :description="t('inbox.automation.away.hint')">
      <div class="flex flex-col gap-4">
        <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
          <USwitch v-model="draft.away.enabled" :disabled="off" data-testid="inbox-away-enabled" />{{ t('inbox.automation.enable') }}
        </label>
        <template v-if="draft.away.enabled">
          <UFormField :label="t('inbox.automation.away.repeatHours')" :description="t('inbox.automation.away.repeatHoursHint')">
            <UInputNumber v-model="draft.away.repeatHours" class="w-40" :min="1" :max="168" :disabled="off" />
          </UFormField>
          <InboxAutoContentEditor v-model="draft.away.content" :label="t('inbox.automation.away.title')" :channel-id="props.channelId" :kind="props.kind" />
          <p v-if="missing('away')" class="text-sm text-error" role="alert">{{ t('inbox.automation.contentRequired') }}</p>
        </template>
      </div>
    </SharedRecordSection>

    <SharedRecordSection variant="panel" :title="t('inbox.automation.csat.title')" :description="t('inbox.automation.csat.hint')">
      <div class="flex flex-col gap-4">
        <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
          <USwitch v-model="draft.csat.enabled" :disabled="off" data-testid="inbox-csat-enabled" />{{ t('inbox.automation.enable') }}
        </label>
        <template v-if="draft.csat.enabled">
          <UFormField :label="t('inbox.automation.csat.question')" :hint="`${draft.csat.question.length}/${csatQuestionMax}`" required>
            <UTextarea v-model="draft.csat.question" class="w-full" :rows="2" autoresize :maxlength="csatQuestionMax" :disabled="off" data-testid="inbox-csat-question" />
          </UFormField>
          <div class="liwan-auto-grid gap-3">
            <UFormField v-for="score in CSAT_SCORES" :key="score" :label="t(`inbox.automation.csat.options.${score}`)" :hint="`${draft.csat[score].length}/20`" required>
              <UInput v-model="draft.csat[score]" class="w-full" :maxlength="20" :disabled="off" :data-testid="`inbox-csat-${score}`" />
            </UFormField>
          </div>
          <p v-if="csatTooLong" class="text-sm text-error" role="alert" data-testid="inbox-csat-too-long">{{ t('inbox.automation.csat.tooLong', { max: TIKTOK_SURVEY_QUESTION_MAX }) }}</p>
        </template>
      </div>
    </SharedRecordSection>

    <p v-if="attempted && !write" class="text-sm text-error" role="alert" data-testid="inbox-automation-invalid">{{ t('inbox.automation.invalid') }}</p>
    <div class="flex justify-end">
      <UButton type="submit" :disabled="off || !dirty" :loading="isPending" :label="t('app.save')" data-testid="inbox-automation-save" />
    </div>
  </form>
</template>
