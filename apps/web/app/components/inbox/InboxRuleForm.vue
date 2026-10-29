<script setup lang="ts">
import type { InboxRule } from '@webvue/contracts'
import InboxAutoContentEditor from '@/components/inbox/InboxAutoContentEditor.vue'
import { RULE_HOURS, RULE_MATCH_KINDS, TEXT_MATCH_KINDS, emptyRuleDraft, ruleToDraft, ruleWrite, ruleWriteCandidate } from '@/composables/inbox/inboxAutomation'
import { PRIORITIES } from '@/composables/inbox/inboxPresentation'
import { useInboxAgents, useInboxTags } from '@/composables/inbox/useInbox'
import { useSaveInboxRule } from '@/composables/inbox/useInboxAutomation'
import { useInboxChannels, useInboxDepartments } from '@/composables/inbox/useInboxSettings'

// A rule: when a customer message matches (its words, or the option they chose from an interactive message, optionally
// only inside or outside working hours) the rule can reply, route the conversation, tag it, set its priority or
// resolve it. At least one action is required; the contract decides what is valid, and the server checks the rest.
const props = defineProps<{ rule?: InboxRule; backTo: string }>()
const emit = defineEmits<{ saved: [rule: InboxRule] }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const { mutateAsync: save, isPending } = useSaveInboxRule()
const channels = useInboxChannels()
const departments = useInboxDepartments()
const tags = useInboxTags()
const agents = useInboxAgents()

const draft = reactive(props.rule ? ruleToDraft(props.rule) : emptyRuleDraft())
const initial = JSON.stringify(ruleWriteCandidate(draft))
const dirty = computed(() => !saved.value && JSON.stringify(ruleWriteCandidate(draft)) !== initial)
const saved = ref(false)
const attempted = ref(false)
const serverError = ref<{ field?: string; message: string } | null>(null)
const off = computed(() => !hydrated.value || isPending.value)
const write = computed(() => ruleWrite(draft))

const isText = computed(() => TEXT_MATCH_KINDS.includes(draft.matchKind))
const ANY = 'any'
const NONE = 'none'
const channelItems = computed(() => [{ value: ANY, label: t('inbox.automation.rules.anyChannel') }, ...(channels.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name }))])
const departmentItems = computed(() => [{ value: NONE, label: t('inbox.automation.rules.noChange') }, ...(departments.data.value?.items ?? []).map(item => ({ value: String(item.id), label: item.name }))])
const priorityItems = computed(() => [{ value: NONE, label: t('inbox.automation.rules.noChange') }, ...PRIORITIES.map(value => ({ value, label: t(`inbox.priorities.${value}`) }))])
const matchItems = computed(() => RULE_MATCH_KINDS.map(value => ({ value, label: t(`inbox.automation.rules.match.${value}`) })))
const hoursItems = computed(() => RULE_HOURS.map(value => ({ value, label: t(`inbox.automation.rules.hours.${value}`) })))
const tagItems = computed(() => tags.data.value?.items ?? [])

const nameError = computed(() => attempted.value && !draft.name.trim() ? t('inbox.settings.requiredName') : undefined)
const matchError = computed(() => {
  if (!attempted.value) return undefined
  if (isText.value && !draft.keywords.some(word => word.trim())) return t('inbox.automation.rules.keywordsRequired')
  if (draft.matchKind === 'option' && !draft.optionId.trim()) return t('inbox.automation.rules.optionRequired')
  return undefined
})
const replyError = computed(() => attempted.value && draft.replyEnabled && write.value === null && !!draft.name.trim() && !matchError.value ? t('inbox.automation.contentRequired') : undefined)
const hasAction = computed(() => draft.replyEnabled || draft.departmentId !== null || draft.assigneeId !== null || draft.tagIds.length > 0 || draft.priority !== null || draft.resolve)
const actionError = computed(() => attempted.value && !hasAction.value ? t('inbox.automation.rules.actionRequired') : undefined)
const fieldError = (field: string) => serverError.value?.field === field ? serverError.value.message : undefined

async function submit() {
  attempted.value = true
  serverError.value = null
  const body = write.value
  if (off.value || !body || nameError.value) return
  try {
    const rule = await save({ id: props.rule?.id, body })
    saved.value = true
    toast.add({ title: t('inbox.settings.saved'), color: 'success' })
    emit('saved', rule)
  } catch (e) {
    const field = (e as { field?: string }).field
    serverError.value = { field, message: e instanceof Error ? e.message : t('errors.generic') }
    toast.add({ title: serverError.value.message, color: 'error' })
  }
}
</script>

<template>
  <form class="flex flex-col gap-5" novalidate data-testid="inbox-rule-form" @submit.prevent="submit">
    <SharedUnsavedChanges :dirty="dirty" />

    <UFormField :label="t('inbox.settings.name')" required :error="nameError ?? fieldError('name')">
      <UInput v-model="draft.name" class="w-full" maxlength="128" :disabled="off" data-testid="inbox-rule-name" />
    </UFormField>
    <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
      <USwitch v-model="draft.active" :disabled="off" data-testid="inbox-rule-active" />{{ t('inbox.automation.rules.active') }}
    </label>

    <SharedSubCard class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.automation.rules.when') }}</h3>
      <UFormField :label="t('inbox.automation.rules.channel')">
        <USelect :model-value="draft.channelId ? String(draft.channelId) : ANY" :items="channelItems" class="w-full" :disabled="off" @update:model-value="draft.channelId = $event === ANY ? null : Number($event)" />
      </UFormField>
      <UFormField :label="t('inbox.automation.rules.matchLabel')">
        <USelect v-model="draft.matchKind" :items="matchItems" class="w-full" :disabled="off" data-testid="inbox-rule-match" />
      </UFormField>
      <UFormField v-if="isText" :label="t('inbox.automation.rules.keywords')" :description="t('inbox.automation.rules.keywordsHint')" required :error="matchError ?? fieldError('keywords')">
        <UInputTags v-model="draft.keywords" class="w-full" :disabled="off" :max-length="128" :aria-label="t('inbox.automation.rules.keywords')" data-testid="inbox-rule-keywords" />
      </UFormField>
      <UFormField v-else-if="draft.matchKind === 'option'" :label="t('inbox.automation.rules.optionId')" :description="t('inbox.automation.rules.optionIdHint')" required :error="matchError ?? fieldError('option_id')">
        <UInput v-model="draft.optionId" class="w-full" dir="ltr" maxlength="200" placeholder="btn_1" :disabled="off" data-testid="inbox-rule-option" />
      </UFormField>
      <UFormField :label="t('inbox.automation.rules.hoursLabel')">
        <USelect v-model="draft.hours" :items="hoursItems" class="w-full" :disabled="off" />
      </UFormField>
    </SharedSubCard>

    <SharedSubCard class="flex flex-col gap-3">
      <h3 class="text-sm font-semibold text-highlighted">{{ t('inbox.automation.rules.then') }}</h3>
      <p v-if="actionError" class="text-sm text-error" role="alert">{{ actionError }}</p>
      <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
        <USwitch v-model="draft.replyEnabled" :disabled="off" data-testid="inbox-rule-reply-enabled" />{{ t('inbox.automation.rules.replyAction') }}
      </label>
      <template v-if="draft.replyEnabled">
        <InboxAutoContentEditor v-model="draft.reply" :label="t('inbox.automation.rules.replyAction')" />
        <p v-if="replyError ?? fieldError('reply')" class="text-sm text-error" role="alert">{{ replyError ?? fieldError('reply') }}</p>
      </template>
      <UFormField :label="t('inbox.automation.rules.department')">
        <USelect :model-value="draft.departmentId ? String(draft.departmentId) : NONE" :items="departmentItems" class="w-full" :disabled="off" @update:model-value="draft.departmentId = $event === NONE ? null : Number($event)" />
      </UFormField>
      <UFormField :label="t('inbox.automation.rules.assignee')">
        <SharedPersonPicker v-model="draft.assigneeId" value-key="user_id" :options="agents.data.value?.items ?? []" :known="props.rule?.assignee ? [props.rule.assignee] : []" :placeholder="t('inbox.automation.rules.noChange')" :disabled="off" :aria-label="t('inbox.automation.rules.assignee')" />
      </UFormField>
      <UFormField :label="t('inbox.automation.rules.tags')">
        <USelectMenu v-model="draft.tagIds" multiple value-key="id" label-key="name" :items="tagItems" class="w-full" :disabled="off" :placeholder="t('inbox.automation.rules.noChange')" :aria-label="t('inbox.automation.rules.tags')" />
      </UFormField>
      <UFormField :label="t('inbox.automation.rules.priority')">
        <USelect :model-value="draft.priority ?? NONE" :items="priorityItems" class="w-full" :disabled="off" @update:model-value="draft.priority = $event === NONE ? null : ($event as typeof draft.priority)" />
      </UFormField>
      <label class="flex items-center gap-3 text-sm font-medium text-highlighted">
        <USwitch v-model="draft.resolve" :disabled="off" />{{ t('inbox.automation.rules.resolveAction') }}
      </label>
    </SharedSubCard>

    <label class="flex items-start gap-3 text-sm">
      <USwitch v-model="draft.stop" class="mt-0.5" :disabled="off" data-testid="inbox-rule-stop" />
      <span><span class="block font-medium text-highlighted">{{ t('inbox.automation.rules.stop') }}</span><span class="block text-xs text-muted">{{ t('inbox.automation.rules.stopHint') }}</span></span>
    </label>

    <div class="flex justify-end gap-2">
      <UButton :to="props.backTo" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" />
      <UButton type="submit" :disabled="off" :loading="isPending" :label="props.rule ? t('app.save') : t('inbox.automation.rules.create')" data-testid="inbox-rule-submit" />
    </div>
  </form>
</template>
