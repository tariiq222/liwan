<script setup lang="ts">
import {
  TEMPLATE_LIMITS, buttonProblems, canAddButton, emptyButton, moveItem,
  type ButtonDraft, type ButtonKind,
} from '@/composables/inbox/inboxTemplate'

// The buttons under a template, with Meta's limits shown as they are reached: ten buttons in all, two urls, one phone
// number, one copy-code, and quick replies grouped together. A url may end with one variable ({{1}}) that is filled
// per message; it then needs a full example url for review.
const buttons = defineModel<ButtonDraft[]>({ required: true })
const props = defineProps<{ disabled?: boolean }>()
const { t } = useI18n()
const KINDS: readonly ButtonKind[] = ['quick_reply', 'url', 'phone_number', 'copy_code']
const ICON: Record<ButtonKind, string> = { quick_reply: 'i-lucide-reply', url: 'i-lucide-external-link', phone_number: 'i-lucide-phone', copy_code: 'i-lucide-copy' }
const problems = computed(() => buttonProblems(buttons.value))
const hasVariable = (button: ButtonDraft) => button.url.trim().endsWith('{{1}}')

function add(kind: ButtonKind) {
  if (props.disabled || !canAddButton(buttons.value, kind)) return
  buttons.value = [...buttons.value, emptyButton(kind)]
}
function remove(index: number) {
  buttons.value = buttons.value.filter((_, position) => position !== index)
}
function move(index: number, step: -1 | 1) {
  buttons.value = moveItem(buttons.value, index, step)
}
function addUrlVariable(button: ButtonDraft) {
  if (!hasVariable(button)) button.url = `${button.url.trim()}{{1}}`
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="inbox-template-buttons">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-for="kind in KINDS"
        :key="kind"
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        :icon="ICON[kind]"
        :label="t(`inbox.templates.button.kind.${kind}`)"
        :disabled="props.disabled || !canAddButton(buttons, kind)"
        :data-testid="`inbox-template-add-${kind}`"
        @click="add(kind)"
      />
      <span class="ms-auto text-xs text-muted" data-testid="inbox-template-buttons-count">{{ t('inbox.templates.button.count', { n: buttons.length, max: TEMPLATE_LIMITS.buttons }) }}</span>
    </div>
    <p class="text-xs text-muted">{{ t('inbox.templates.button.limits') }}</p>
    <ul v-if="problems.length" class="text-xs text-error" role="alert" data-testid="inbox-template-buttons-problems">
      <li v-for="problem in problems" :key="problem">{{ t(`inbox.templates.button.problem.${problem}`) }}</li>
    </ul>

    <ol v-if="buttons.length" class="flex flex-col gap-3">
      <li v-for="(button, index) in buttons" :key="button.key" class="flex flex-col gap-3 rounded-card p-3 ring ring-default" :data-testid="`inbox-template-button-${index}`">
        <div class="flex items-center gap-2">
          <UIcon :name="ICON[button.type]" class="size-4 shrink-0 text-muted" aria-hidden="true" />
          <span class="min-w-0 flex-1 text-sm font-medium">{{ t(`inbox.templates.button.kind.${button.type}`) }}</span>
          <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-up" :aria-label="t('inbox.templates.button.moveUp')" :disabled="props.disabled || index === 0" @click="move(index, -1)" />
          <UButton type="button" color="neutral" variant="ghost" size="sm" icon="i-lucide-arrow-down" :aria-label="t('inbox.templates.button.moveDown')" :disabled="props.disabled || index === buttons.length - 1" @click="move(index, 1)" />
          <UButton type="button" color="error" variant="ghost" size="sm" icon="i-lucide-trash-2" :aria-label="t('inbox.templates.button.remove')" :disabled="props.disabled" @click="remove(index)" />
        </div>

        <template v-if="button.type === 'copy_code'">
          <p class="text-xs text-muted">{{ t('inbox.templates.button.copyCodeHint') }}</p>
          <UFormField :label="t('inbox.templates.button.couponExample')" required>
            <UInput v-model="button.example" class="w-full" dir="ltr" :maxlength="TEMPLATE_LIMITS.couponExample" :disabled="props.disabled" />
          </UFormField>
        </template>
        <template v-else>
          <UFormField :label="t('inbox.templates.button.text')" required>
            <UInput v-model="button.text" class="w-full" :maxlength="TEMPLATE_LIMITS.buttonText" :disabled="props.disabled" />
            <template #hint><span class="text-xs text-muted">{{ button.text.length }}/{{ TEMPLATE_LIMITS.buttonText }}</span></template>
          </UFormField>
          <template v-if="button.type === 'url'">
            <UFormField :label="t('inbox.templates.button.url')" required>
              <div class="flex gap-2">
                <UInput v-model="button.url" class="min-w-0 flex-1" dir="ltr" inputmode="url" placeholder="https://" :maxlength="TEMPLATE_LIMITS.url" :disabled="props.disabled" />
                <UButton type="button" color="neutral" variant="outline" :label="t('inbox.templates.button.addUrlVariable')" :disabled="props.disabled || hasVariable(button)" @click="addUrlVariable(button)" />
              </div>
            </UFormField>
            <UFormField v-if="hasVariable(button)" :label="t('inbox.templates.button.urlExample')" :description="t('inbox.templates.button.urlExampleHint')" required>
              <UInput v-model="button.example" class="w-full" dir="ltr" inputmode="url" placeholder="https://" :maxlength="TEMPLATE_LIMITS.url" :disabled="props.disabled" />
            </UFormField>
          </template>
          <UFormField v-else-if="button.type === 'phone_number'" :label="t('inbox.templates.button.phone')" :description="t('inbox.templates.button.phoneHint')" required>
            <UInput v-model="button.phone_number" class="w-full" dir="ltr" inputmode="tel" placeholder="+966500000000" :disabled="props.disabled" />
          </UFormField>
        </template>
      </li>
    </ol>
    <p v-else class="text-sm text-muted">{{ t('inbox.templates.button.none') }}</p>
  </div>
</template>
