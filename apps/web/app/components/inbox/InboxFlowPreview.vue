<script setup lang="ts">
import type { FlowPreviewComponent, FlowPreviewModel } from '@/composables/inbox/inboxFlow'

// The form as the customer will see it: a phone-like sheet with the screen's title, its components in order, required
// markers and the bottom button, with a stepper through the screens. Its direction follows the form's language, not the
// page, because that is how the customer's phone draws it. It shows the draft as typed, so nothing here is validated.
const props = defineProps<{ model: FlowPreviewModel }>()
const screen = defineModel<number>('screen', { default: 0 })
const { t } = useI18n()
const count = computed(() => props.model.screens.length)
const index = computed(() => Math.min(Math.max(screen.value, 0), Math.max(count.value - 1, 0)))
const current = computed(() => props.model.screens[index.value])
const isLast = computed(() => index.value === count.value - 1)
const empty = (value: string) => value || t('inbox.flows.preview.emptyLabel')
const step = (by: -1 | 1) => { screen.value = Math.min(Math.max(index.value + by, 0), count.value - 1) }
const CHOICE_ICON = { radio: 'i-lucide-circle', checkbox: 'i-lucide-square', dropdown: 'i-lucide-chevron-down' } as const
const isChoice = (component: FlowPreviewComponent): component is Extract<FlowPreviewComponent, { options: unknown }> => 'options' in component
</script>

<template>
  <div class="rounded-card bg-elevated/60 p-3" data-testid="inbox-flow-preview">
    <div v-if="count > 1" class="mb-2 flex items-center justify-between gap-2">
      <UButton type="button" color="neutral" variant="ghost" size="xs" icon="i-lucide-chevron-left" class="rtl:rotate-180" :aria-label="t('inbox.flows.preview.previous')" :disabled="index === 0" data-testid="inbox-flow-preview-previous" @click="step(-1)" />
      <span class="text-xs text-muted" data-testid="inbox-flow-preview-step">{{ t('inbox.flows.preview.step', { n: index + 1, total: count }) }}</span>
      <UButton type="button" color="neutral" variant="ghost" size="xs" icon="i-lucide-chevron-right" class="rtl:rotate-180" :aria-label="t('inbox.flows.preview.next')" :disabled="isLast" data-testid="inbox-flow-preview-next" @click="step(1)" />
    </div>
    <div v-if="current" :dir="props.model.direction" class="mx-auto flex max-w-xs flex-col overflow-hidden rounded-card bg-default text-start shadow-xs ring ring-default">
      <h3 class="border-b border-default px-3 py-2 text-center text-sm font-semibold text-highlighted break-words" data-testid="inbox-flow-preview-title">{{ empty(current.title) }}</h3>
      <div class="flex max-h-96 flex-col gap-3 overflow-y-auto p-3 text-sm">
        <template v-for="(component, position) in current.components" :key="position">
          <p v-if="component.kind === 'heading'" dir="auto" class="text-lg font-bold break-words">{{ empty(component.text) }}</p>
          <p v-else-if="component.kind === 'subheading'" dir="auto" class="font-semibold break-words">{{ empty(component.text) }}</p>
          <p v-else-if="component.kind === 'text'" dir="auto" class="whitespace-pre-wrap break-words">{{ empty(component.text) }}</p>
          <p v-else-if="component.kind === 'caption'" dir="auto" class="text-xs text-muted break-words">{{ empty(component.text) }}</p>
          <label v-else-if="component.kind === 'opt_in'" class="flex items-start gap-2">
            <UIcon name="i-lucide-square" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
            <span dir="auto" class="min-w-0 break-words">{{ empty(component.label) }}<span v-if="component.required" class="text-error" aria-hidden="true"> *</span></span>
          </label>
          <div v-else-if="'label' in component" class="flex flex-col gap-1">
            <span dir="auto" class="font-medium break-words">{{ empty(component.label) }}<span v-if="component.required" class="text-error" aria-hidden="true"> *</span></span>
            <div v-if="component.kind === 'text_input' || component.kind === 'text_area' || component.kind === 'date'" class="flex items-center justify-between rounded-control px-3 py-2 text-muted ring ring-accented" :class="component.kind === 'text_area' ? 'min-h-16 items-start' : ''">
              <span>{{ component.kind === 'date' ? t('inbox.flows.preview.datePlaceholder') : '' }}</span>
              <UIcon v-if="component.kind === 'date'" name="i-lucide-calendar" class="size-4" aria-hidden="true" />
            </div>
            <div v-else-if="component.kind === 'dropdown'" class="flex items-center justify-between rounded-control px-3 py-2 text-muted ring ring-accented">
              <span>{{ t('inbox.flows.preview.choose') }}</span><UIcon :name="CHOICE_ICON.dropdown" class="size-4" aria-hidden="true" />
            </div>
            <ul v-else-if="isChoice(component)" class="flex flex-col gap-1.5">
              <li v-for="(option, optionIndex) in component.options" :key="optionIndex" class="flex items-start gap-2">
                <UIcon :name="CHOICE_ICON[component.kind as 'radio' | 'checkbox']" class="mt-0.5 size-4 shrink-0 text-muted" aria-hidden="true" />
                <span dir="auto" class="min-w-0 break-words">{{ empty(option.title) }}<span v-if="option.description" class="block text-xs text-muted">{{ option.description }}</span></span>
              </li>
            </ul>
            <span v-if="'helper' in component && component.helper" dir="auto" class="text-xs text-muted break-words">{{ component.helper }}</span>
          </div>
        </template>
      </div>
      <div class="border-t border-default p-3">
        <span class="block rounded-full bg-primary px-4 py-2 text-center text-sm font-medium text-inverted break-words" data-testid="inbox-flow-preview-footer">{{ empty(current.footer) }}</span>
      </div>
    </div>
  </div>
</template>
