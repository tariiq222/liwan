<script setup lang="ts">
import type { InboxRuleTestResult } from '@webvue/contracts'
import { useTestInboxRules } from '@/composables/inbox/useInboxAutomation'
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'

// "Try it": a sample customer message (its words, or the option chosen) on a channel, answered with what the
// automation would do: inside or outside hours, the welcome or away message, and the rules that match in order.
// A dry run on the server; nothing is sent and no conversation changes.
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const channels = useInboxChannels()
const { mutate: run, isPending } = useTestInboxRules()
const channelId = ref<number | null>(null)
const text = ref('')
const optionId = ref('')
const result = ref<InboxRuleTestResult | null>(null)
const channelItems = computed(() => (channels.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name })))
const selected = computed(() => channelId.value ?? channels.data.value?.items[0]?.id ?? null)
const canRun = computed(() => hydrated.value && !isPending.value && selected.value !== null)

function submit() {
  if (!canRun.value || selected.value === null) return
  run({ channel_id: selected.value, text: text.value.trim() || null, option_id: optionId.value.trim() || null, at: null }, {
    onSuccess: (value) => { result.value = value },
    onError: e => toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' }),
  })
}
</script>

<template>
  <SharedRecordSection variant="panel" :title="t('inbox.automation.test.title')" :description="t('inbox.automation.test.hint')">
    <form class="flex flex-col gap-3" novalidate data-testid="inbox-rule-test" @submit.prevent="submit">
      <div class="grid gap-3 sm:grid-cols-2">
        <UFormField :label="t('inbox.automation.test.channel')">
          <USelect :model-value="selected === null ? undefined : String(selected)" :items="channelItems" class="w-full" :disabled="!hydrated" @update:model-value="channelId = Number($event)" />
        </UFormField>
        <UFormField :label="t('inbox.automation.test.option')" :description="t('inbox.automation.test.optionHint')">
          <UInput v-model="optionId" class="w-full" dir="ltr" placeholder="btn_1" :disabled="!hydrated" />
        </UFormField>
      </div>
      <UFormField :label="t('inbox.automation.test.message')">
        <UTextarea v-model="text" class="w-full" :rows="2" autoresize :maxlength="4096" :disabled="!hydrated" data-testid="inbox-rule-test-text" />
      </UFormField>
      <div class="flex justify-end">
        <UButton type="submit" icon="i-lucide-flask-conical" :disabled="!canRun" :loading="isPending" :label="t('inbox.automation.test.run')" data-testid="inbox-rule-test-run" />
      </div>
    </form>
    <div v-if="result" class="mt-3 flex flex-col gap-2 rounded-control bg-elevated/50 p-3 text-sm" role="status" data-testid="inbox-rule-test-result">
      <p><span class="font-medium text-highlighted">{{ t('inbox.automation.test.hours') }}:</span> {{ result.inside_hours ? t('inbox.automation.test.inside') : t('inbox.automation.test.outside') }}</p>
      <p data-testid="inbox-rule-test-auto"><span class="font-medium text-highlighted">{{ t('inbox.automation.test.autoMessage') }}:</span> {{ result.auto_message ? t(`inbox.automation.test.auto.${result.auto_message}`) : t('inbox.automation.test.none') }}</p>
      <div data-testid="inbox-rule-test-rules">
        <p class="font-medium text-highlighted">{{ t('inbox.automation.test.rules') }}</p>
        <p v-if="!result.rules.length" class="text-muted">{{ t('inbox.automation.test.noRules') }}</p>
        <ol v-else class="mt-1 list-decimal ps-5">
          <li v-for="rule in result.rules" :key="rule.id">{{ rule.name }}</li>
        </ol>
      </div>
    </div>
  </SharedRecordSection>
</template>
