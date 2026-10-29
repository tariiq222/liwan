<script setup lang="ts">
import InboxInteractiveBuilder from '@/components/inbox/InboxInteractiveBuilder.vue'
import type { AutoContentDraft, AutoContentMode } from '@/composables/inbox/inboxAutomation'

// What an automatic message or a rule reply says: plain text, or an interactive message built with the same builder
// the composer uses (reply buttons, a list or a link). The button and row ids the builder generates are the option
// ids a rule can match when the customer answers.
const draft = defineModel<AutoContentDraft>({ required: true })
const props = defineProps<{ label: string }>()
const { t } = useI18n()
const hydrated = useHydrated()
const MAX_TEXT = 4096
const modeItems = computed(() => (['text', 'interactive'] as AutoContentMode[]).map(value => ({ value, label: t(`inbox.automation.content.${value}`) })))
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="inbox-auto-content">
    <SharedSegmentedControl v-model="draft.mode" class="self-start" :items="modeItems" :label="props.label" />
    <UFormField v-if="draft.mode === 'text'" :label="t('inbox.automation.content.body')" :hint="`${draft.body.length}/${MAX_TEXT}`" required>
      <UTextarea v-model="draft.body" class="w-full" :rows="3" autoresize :maxrows="8" :maxlength="MAX_TEXT" :disabled="!hydrated" data-testid="inbox-auto-content-body" />
    </UFormField>
    <InboxInteractiveBuilder v-else v-model="draft.interactive" />
  </div>
</template>
