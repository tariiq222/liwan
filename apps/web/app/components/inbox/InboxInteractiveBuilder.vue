<script setup lang="ts">
import InboxFlowBubble from '@/components/inbox/InboxFlowBubble.vue'
import { useInboxSendableFlows } from '@/composables/inbox/useInboxFlows'
import { INTERACTIVE_LIMITS, INTERACTIVE_TYPES, interactiveRowCount, type InteractiveDraft } from '@/composables/inbox/inboxInteractive'

// Builds the interactive message an agent sends: up to three reply buttons, a list of up to ten rows in sections, or
// one call-to-action link. Every field shows its Meta limit as a live counter; the composer sends only a valid draft.
const draft = defineModel<InteractiveDraft>({ required: true })
// A form message opens a published form of one channel, so the type needs the channel the message is sent on.
const props = defineProps<{ channelId?: number | null }>()
const { t } = useI18n()
const hydrated = useHydrated()
const limits = INTERACTIVE_LIMITS
const typeItems = computed(() => INTERACTIVE_TYPES.map(value => ({ value, label: t(`inbox.composer.interactive.types.${value}`) })))
const rows = computed(() => interactiveRowCount(draft.value))
const counter = (value: string, max: number) => `${value.length}/${max}`
const flows = useInboxSendableFlows(() => props.channelId, () => draft.value.type === 'flow')
const chosenFlow = computed(() => flows.data.value?.items.find(flow => flow.id === draft.value.flowId))
// A form belongs to one channel: changing the channel under a chosen form drops the choice.
watch(() => props.channelId, (next, previous) => { if (next !== previous) draft.value.flowId = null })

function addButton() {
  if (draft.value.buttons.length < limits.buttons) draft.value.buttons.push('')
}
function addSection() {
  if (draft.value.sections.length < limits.sections) draft.value.sections.push({ title: '', rows: [{ title: '', description: '' }] })
}
function addRow(section: number) {
  if (rows.value < limits.rows) draft.value.sections[section]!.rows.push({ title: '', description: '' })
}
function removeSection(section: number) {
  draft.value.sections.splice(section, 1)
}
function removeRow(section: number, row: number) {
  const target = draft.value.sections[section]!
  target.rows.splice(row, 1)
  if (!target.rows.length) removeSection(section)
}
</script>

<template>
  <SharedSubCard tone="tinted" class="flex flex-col gap-2" data-testid="inbox-interactive-builder">
    <SharedSegmentedControl v-model="draft.type" class="self-start" :items="typeItems" :label="t('inbox.composer.interactive.type')" />
    <UFormField :label="t('inbox.composer.interactive.header')" :hint="counter(draft.header, limits.header)">
      <UInput v-model="draft.header" class="w-full" :maxlength="limits.header" :disabled="!hydrated" />
    </UFormField>
    <UFormField :label="t('inbox.composer.interactive.body')" :hint="counter(draft.body, limits.body)" required>
      <UTextarea v-model="draft.body" class="w-full" :rows="2" autoresize :maxrows="6" :maxlength="limits.body" :disabled="!hydrated" />
    </UFormField>
    <UFormField :label="t('inbox.composer.interactive.footer')" :hint="counter(draft.footer, limits.footer)">
      <UInput v-model="draft.footer" class="w-full" :maxlength="limits.footer" :disabled="!hydrated" />
    </UFormField>

    <template v-if="draft.type === 'buttons'">
      <UFormField v-for="(_, index) in draft.buttons" :key="index" :label="t('inbox.composer.interactive.button', { n: index + 1 })" :hint="counter(draft.buttons[index]!, limits.buttonTitle)" required>
        <div class="flex items-center gap-2">
          <UInput v-model="draft.buttons[index]" class="min-w-0 flex-1" :maxlength="limits.buttonTitle" :disabled="!hydrated" />
          <UButton v-if="draft.buttons.length > 1" type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('inbox.composer.interactive.remove')" @click="draft.buttons.splice(index, 1)" />
        </div>
      </UFormField>
      <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.composer.interactive.addButton')" :disabled="!hydrated || draft.buttons.length >= limits.buttons" @click="addButton" />
    </template>

    <template v-else-if="draft.type === 'list'">
      <UFormField :label="t('inbox.composer.interactive.listButton')" :hint="counter(draft.listButton, limits.listButton)" required>
        <UInput v-model="draft.listButton" class="w-full" :maxlength="limits.listButton" :disabled="!hydrated" />
      </UFormField>
      <p class="text-xs text-muted" data-testid="inbox-interactive-rows">{{ t('inbox.composer.interactive.rows', { n: rows, max: limits.rows }) }}</p>
      <SharedSubCard v-for="(section, sectionIndex) in draft.sections" :key="sectionIndex" class="flex flex-col gap-2">
        <div class="flex items-end gap-2">
          <UFormField class="min-w-0 flex-1" :label="t('inbox.composer.interactive.sectionTitle')" :hint="counter(section.title, limits.sectionTitle)">
            <UInput v-model="section.title" class="w-full" :maxlength="limits.sectionTitle" :disabled="!hydrated" />
          </UFormField>
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-trash-2" :aria-label="t('inbox.composer.interactive.removeSection')" @click="removeSection(sectionIndex)" />
        </div>
        <div v-for="(row, rowIndex) in section.rows" :key="rowIndex" class="flex items-end gap-2">
          <UFormField class="min-w-0 flex-1" :label="t('inbox.composer.interactive.rowTitle')" :hint="counter(row.title, limits.rowTitle)" required>
            <UInput v-model="row.title" class="w-full" :maxlength="limits.rowTitle" :disabled="!hydrated" />
          </UFormField>
          <UFormField class="min-w-0 flex-1" :label="t('inbox.composer.interactive.rowDescription')" :hint="counter(row.description, limits.rowDescription)">
            <UInput v-model="row.description" class="w-full" :maxlength="limits.rowDescription" :disabled="!hydrated" />
          </UFormField>
          <UButton type="button" color="neutral" variant="ghost" icon="i-lucide-x" :aria-label="t('inbox.composer.interactive.remove')" @click="removeRow(sectionIndex, rowIndex)" />
        </div>
        <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-plus" :label="t('inbox.composer.interactive.addRow')" :disabled="!hydrated || rows >= limits.rows" @click="addRow(sectionIndex)" />
      </SharedSubCard>
      <UButton type="button" class="self-start" color="neutral" variant="outline" icon="i-lucide-list-plus" :label="t('inbox.composer.interactive.addSection')" :disabled="!hydrated || draft.sections.length >= limits.sections || rows >= limits.rows" @click="addSection" />
    </template>

    <template v-else-if="draft.type === 'flow'">
      <UFormField :label="t('inbox.composer.interactive.flow')" :description="t('inbox.composer.interactive.flowHint')" required>
        <InboxFlowPicker v-model="draft.flowId" :channel-id="props.channelId ?? null" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('inbox.composer.interactive.flowCta')" :hint="counter(draft.flowCta, limits.flowCta)" :description="t('inbox.composer.interactive.flowCtaHint')" required>
        <UInput v-model="draft.flowCta" class="w-full" :maxlength="limits.flowCta" :disabled="!hydrated" data-testid="inbox-interactive-flow-cta" />
      </UFormField>
      <div v-if="draft.body.trim() && draft.flowCta.trim()" class="rounded-control bg-default p-3 ring ring-default" data-testid="inbox-interactive-flow-preview">
        <InboxFlowBubble :message="{ header: draft.header.trim() || null, body: draft.body.trim(), footer: draft.footer.trim() || null, cta: draft.flowCta.trim() }" :name="chosenFlow?.name" />
      </div>
    </template>

    <template v-else>
      <UFormField :label="t('inbox.composer.interactive.displayText')" :hint="counter(draft.displayText, limits.displayText)" required>
        <UInput v-model="draft.displayText" class="w-full" :maxlength="limits.displayText" :disabled="!hydrated" />
      </UFormField>
      <UFormField :label="t('inbox.composer.interactive.url')" :help="t('inbox.composer.interactive.urlHelp')" required>
        <UInput v-model="draft.url" class="w-full" type="url" dir="ltr" placeholder="https://" :disabled="!hydrated" />
      </UFormField>
    </template>
  </SharedSubCard>
</template>
