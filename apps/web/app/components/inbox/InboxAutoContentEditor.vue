<script setup lang="ts">
import InboxCommerceContentEditor from '@/components/inbox/InboxCommerceContentEditor.vue'
import InboxInteractiveBuilder from '@/components/inbox/InboxInteractiveBuilder.vue'
import type { AutoContentDraft, AutoContentMode } from '@/composables/inbox/inboxAutomation'
import { useInboxCatalogEnabled } from '@/composables/inbox/useInboxCatalog'

// What an automatic message or a rule reply says: plain text, or an interactive message built with the same builder
// the composer uses (reply buttons, a list or a link). The button and row ids the builder generates are the option
// ids a rule can match when the customer answers. With the catalog feature it can also send products from the channel's
// catalog; `channelId` (null for a rule on all channels) says which catalog the products come from.
const draft = defineModel<AutoContentDraft>({ required: true })
const props = defineProps<{ label: string; channelId?: number | null }>()
const { t } = useI18n()
const hydrated = useHydrated()
const MAX_TEXT = 4096
const catalogOn = useInboxCatalogEnabled()
// A stored commerce message stays editable even if the feature was switched off since.
const modes = computed<AutoContentMode[]>(() => (catalogOn.value || draft.value.mode === 'commerce' ? ['text', 'interactive', 'commerce'] : ['text', 'interactive']))
const modeItems = computed(() => modes.value.map(value => ({ value, label: t(`inbox.automation.content.${value}`) })))
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="inbox-auto-content">
    <SharedSegmentedControl v-model="draft.mode" class="self-start" :items="modeItems" :label="props.label" />
    <UFormField v-if="draft.mode === 'text'" :label="t('inbox.automation.content.body')" :hint="`${draft.body.length}/${MAX_TEXT}`" required>
      <UTextarea v-model="draft.body" class="w-full" :rows="3" autoresize :maxrows="8" :maxlength="MAX_TEXT" :disabled="!hydrated" data-testid="inbox-auto-content-body" />
    </UFormField>
    <InboxInteractiveBuilder v-else-if="draft.mode === 'interactive'" v-model="draft.interactive" />
    <InboxCommerceContentEditor v-else v-model="draft.commerce" :source="props.channelId ? { channelId: props.channelId } : null" />
  </div>
</template>
