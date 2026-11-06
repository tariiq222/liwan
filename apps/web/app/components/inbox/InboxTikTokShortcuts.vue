<script setup lang="ts">
import { INBOX_TIKTOK_LIMITS, type InboxTikTokShortcut, type InboxTikTokShortcutKind } from '@liwan/contracts'
import {
  SHORTCUT_AUDIT_TONE, buildShortcut, emptyShortcutDraft, nextShortcutSequence, shortcutEditBlocked, shortcutLimitReached, shortcutToDraft, type ShortcutDraft,
} from '@/composables/inbox/inboxTikTokShortcuts'
import {
  inboxTikTokErrorKey, useDeleteInboxTikTokShortcut, useEnableInboxTikTokShortcuts, useInboxTikTokShortcuts, useSaveInboxTikTokShortcut,
} from '@/composables/inbox/inboxTikTok'

// The suggested questions (up to 3) and chat prompts (up to 6) LiwanOS mirrors to TikTok (D10). Each kind has its own
// switch: turning one on makes TikTok recreate every stored item, so the server's answer replaces the list. Items are
// created and edited in place, never in a dialog; TikTok's review locks an item (no edit until it settles) and the
// lengths are TikTok's.
const props = defineProps<{ channelId: number; questionsEnabled: boolean; promptsEnabled: boolean }>()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const query = useInboxTikTokShortcuts(() => props.channelId)
const items = computed(() => query.data.value?.items ?? [])
const { mutateAsync: save, isPending: saving } = useSaveInboxTikTokShortcut(() => props.channelId)
const { mutate: remove, isPending: removing } = useDeleteInboxTikTokShortcut(() => props.channelId)
const { mutate: enable } = useEnableInboxTikTokShortcuts(() => props.channelId)

const KINDS: readonly InboxTikTokShortcutKind[] = ['question', 'prompt']
const enabled = reactive({ question: props.questionsEnabled, prompt: props.promptsEnabled })
watch(() => [props.questionsEnabled, props.promptsEnabled] as const, ([questions, prompts]) => {
  enabled.question = questions
  enabled.prompt = prompts
})
const limitReached = computed(() => ({
  question: shortcutLimitReached('question', items.value),
  prompt: shortcutLimitReached('prompt', items.value),
}))
const ofKind = (kind: InboxTikTokShortcutKind) => items.value.filter(item => item.kind === kind)
const counter = (value: string, max: number) => `${value.length}/${max}`
const max = { question: INBOX_TIKTOK_LIMITS.question, answer: INBOX_TIKTOK_LIMITS.answer, title: INBOX_TIKTOK_LIMITS.promptTitle, content: INBOX_TIKTOK_LIMITS.promptContent }

const formKind = ref<InboxTikTokShortcutKind | null>(null)
const editingId = ref<number | null>(null)
const draft = ref<ShortcutDraft>(emptyShortcutDraft('question'))
const attempted = ref(false)
const confirmId = ref<number | null>(null)
const off = computed(() => !hydrated.value || saving.value || removing.value)
const invalid = computed(() => attempted.value && !buildShortcut(draft.value))

function fail(e: unknown) {
  const key = inboxTikTokErrorKey(e)
  toast.add({ title: key ? t(key) : e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
}
function startCreate(kind: InboxTikTokShortcutKind) {
  formKind.value = kind
  editingId.value = null
  draft.value = emptyShortcutDraft(kind)
  attempted.value = false
  confirmId.value = null
}
function startEdit(shortcut: InboxTikTokShortcut) {
  if (shortcutEditBlocked(shortcut)) return
  formKind.value = shortcut.kind
  editingId.value = shortcut.id
  draft.value = shortcutToDraft(shortcut)
  attempted.value = false
  confirmId.value = null
}
function cancel() {
  formKind.value = null
  editingId.value = null
  attempted.value = false
}
async function submit() {
  attempted.value = true
  const write = buildShortcut(draft.value)
  if (!write || off.value) return
  const body = editingId.value && write.kind === 'question'
    ? { question: write.question, answer: write.answer }
    : editingId.value && write.kind === 'prompt' ? { title: write.title, content: write.content } : write
  try {
    await save({ id: editingId.value ?? undefined, body })
    cancel()
    toast.add({ title: t('inbox.tiktok.shortcuts.saved'), color: 'success' })
  } catch (e) {
    fail(e)
  }
}
function toggle(kind: InboxTikTokShortcutKind, value: boolean) {
  enable({ kind, enabled: value }, {
    onSuccess: (answer) => {
      enabled[kind] = answer.enabled
      toast.add({ title: t(`inbox.tiktok.shortcuts.${answer.enabled ? 'enabledOn' : 'enabledOff'}`), color: 'success' })
    },
    onError: fail,
  })
}
function destroy() {
  if (confirmId.value === null) return
  remove(confirmId.value, {
    onSuccess: () => {
      confirmId.value = null
      toast.add({ title: t('inbox.tiktok.shortcuts.deleted'), color: 'success' })
    },
    onError: fail,
  })
}
function nextSequence() {
  return nextShortcutSequence(items.value)
}
function create(kind: InboxTikTokShortcutKind) {
  startCreate(kind)
  draft.value = { ...draft.value, sequence: nextSequence() }
}
</script>

<template>
  <div class="flex flex-col gap-(--liwan-gap-card)" data-testid="inbox-tiktok-shortcuts">
    <SharedRecordSection
      v-for="kind in KINDS"
      :key="kind"
      variant="panel"
      :title="t(`inbox.tiktok.shortcuts.${kind}.title`)"
      :description="t(`inbox.tiktok.shortcuts.${kind}.hint`, { max: kind === 'question' ? INBOX_TIKTOK_LIMITS.questions : INBOX_TIKTOK_LIMITS.prompts })"
    >
      <template #actions>
        <label class="flex items-center gap-2 text-sm text-highlighted">
          <USwitch :model-value="enabled[kind]" :disabled="off" :data-testid="`inbox-tiktok-${kind}-enabled`" @update:model-value="$event => toggle(kind, $event)" />
          {{ t('inbox.tiktok.shortcuts.enabled') }}
        </label>
      </template>
      <div class="flex flex-col gap-3">
        <UAlert v-if="!enabled[kind]" color="neutral" variant="subtle" icon="i-lucide-info" :title="t(`inbox.tiktok.shortcuts.${kind}.disabledHint`)" />
        <SharedPageState :loading="hydrated && query.isPending.value" :error="query.error.value" :empty="!ofKind(kind).length" :empty-text="t(`inbox.tiktok.shortcuts.${kind}.empty`)" @retry="query.refetch()">
          <ul class="flex flex-col divide-y divide-default">
            <li v-for="item in ofKind(kind)" :key="item.id" class="flex flex-wrap items-start justify-between gap-3 py-3">
              <div class="min-w-0 flex-1 text-start">
                <p class="truncate text-sm font-medium text-highlighted">{{ kind === 'question' ? item.question : item.title }}</p>
                <p class="truncate text-sm text-muted">{{ kind === 'question' ? item.answer : item.content }}</p>
                <p v-if="item.sync_error" class="text-xs text-error" role="alert">{{ item.sync_error }}</p>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <SharedStatusBadge size="sm" :tone="SHORTCUT_AUDIT_TONE[item.audit]" :label="t(`inbox.tiktok.audit.${item.audit}`)" :data-testid="`inbox-tiktok-audit-${item.id}`" />
                <UButton type="button" color="neutral" variant="ghost" square icon="i-lucide-pencil" :aria-label="t('inbox.tiktok.shortcuts.edit')" :disabled="off || shortcutEditBlocked(item)" :data-testid="`inbox-tiktok-edit-${item.id}`" @click="startEdit(item)" />
                <UButton type="button" color="error" variant="ghost" square icon="i-lucide-trash-2" :aria-label="t('inbox.tiktok.shortcuts.delete')" :disabled="off" :data-testid="`inbox-tiktok-delete-${item.id}`" @click="confirmId = item.id" />
              </div>
              <SharedInlineConfirm
                v-if="confirmId === item.id"
                class="w-full"
                :title="t('inbox.tiktok.shortcuts.deleteTitle')"
                :description="t('inbox.tiktok.shortcuts.deleteDescription')"
                :confirm-label="t('inbox.tiktok.shortcuts.delete')"
                :pending="removing"
                @confirm="destroy"
                @cancel="confirmId = null"
              />
            </li>
          </ul>
        </SharedPageState>
        <form v-if="formKind === kind" class="flex flex-col gap-3 rounded-control bg-elevated/40 p-3" novalidate :data-testid="`inbox-tiktok-${kind}-form`" @submit.prevent="submit">
          <template v-if="kind === 'question'">
            <UFormField :label="t('inbox.tiktok.shortcuts.field.question')" :hint="counter(draft.question, max.question)" required>
              <UInput v-model="draft.question" class="w-full" :maxlength="max.question" :disabled="off" :data-testid="`inbox-tiktok-${kind}-question`" />
            </UFormField>
            <UFormField :label="t('inbox.tiktok.shortcuts.field.answer')" :hint="counter(draft.answer, max.answer)" required>
              <UTextarea v-model="draft.answer" class="w-full" :rows="2" autoresize :maxlength="max.answer" :disabled="off" :data-testid="`inbox-tiktok-${kind}-answer`" />
            </UFormField>
          </template>
          <template v-else>
            <UFormField :label="t('inbox.tiktok.shortcuts.field.promptTitle')" :hint="counter(draft.title, max.title)" required>
              <UInput v-model="draft.title" class="w-full" :maxlength="max.title" :disabled="off" :data-testid="`inbox-tiktok-${kind}-title`" />
            </UFormField>
            <UFormField :label="t('inbox.tiktok.shortcuts.field.content')" :hint="counter(draft.content, max.content)" required>
              <UTextarea v-model="draft.content" class="w-full" :rows="2" autoresize :maxlength="max.content" :disabled="off" :data-testid="`inbox-tiktok-${kind}-content`" />
            </UFormField>
          </template>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton type="button" color="neutral" variant="outline" :disabled="off" :label="t('app.cancel')" @click="cancel" />
            <UButton type="submit" :disabled="off || (attempted && invalid)" :loading="saving" :label="t('app.save')" :data-testid="`inbox-tiktok-${kind}-save`" />
          </div>
        </form>
        <div v-else class="flex flex-wrap items-center justify-between gap-2">
          <p v-if="limitReached[kind]" class="text-xs text-muted" data-testid="inbox-tiktok-shortcut-limit">{{ t(`inbox.tiktok.shortcuts.${kind}.limit`) }}</p>
          <span v-else />
          <UButton type="button" color="neutral" variant="outline" icon="i-lucide-plus" :label="t(`inbox.tiktok.shortcuts.${kind}.add`)" :disabled="off || limitReached[kind]" :data-testid="`inbox-tiktok-${kind}-add`" @click="create(kind)" />
        </div>
      </div>
    </SharedRecordSection>
  </div>
</template>
