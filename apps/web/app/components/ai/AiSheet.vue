<script setup lang="ts">
import AiAvatar from '@/components/ai/AiAvatar.vue'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiConfirmCard from '@/components/ai/AiConfirmCard.vue'
import AiCopyButton from '@/components/ai/AiCopyButton.vue'
import AiDraftCard from '@/components/ai/AiDraftCard.vue'
import AiLimitNotice from '@/components/ai/AiLimitNotice.vue'
import AiMessage from '@/components/ai/AiMessage.vue'
import AiRecordCards from '@/components/ai/AiRecordCards.vue'
import AiSuggestionChips from '@/components/ai/AiSuggestionChips.vue'
import AiToolTrace from '@/components/ai/AiToolTrace.vue'
import { followSharedConversation } from '@/composables/useAiConversation'
import { useAiNowSection } from '@/composables/useAiNowSection'
import { useAiRun } from '@/composables/useAiRun'
import { assistantContext, useAssistantSheet } from '@/composables/useAssistantSheet'
import { useAttention } from '@/composables/useAttention'
import { useShellModel } from '@/composables/useShellModel'
import { parseAiContext } from '@/utils/aiContext'
import { prepareDraftHandoff, readCreatedId } from '@/utils/aiDraft'
import { AI_STARTER_KEYS, followUpKeys } from '@/utils/aiSuggestions'
import { latestPendingIndex } from '@/utils/aiThread'

// The assistant sheet's body: the shell draws the title, the page pill, "open full page" and close; this is what sits under
// them. "In this page now" is read from the page the user is on and replaced when it changes; it is never part of the thread.
// The conversation below is the full page's own: the same run, the same cards, only smaller.
const NOW_ROWS = 3

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const config = useRuntimeConfig()
const { activeModule } = useShellModel()
// Home looks across every module; settings, the account and an unknown page have nothing of the kind to show.
const nowScope = computed(() => (activeModule.value === 'home' ? 'all' : activeModule.value === 'settings' ? null : activeModule.value))
const { rows, pending, failed } = useAttention(nowScope, { limit: NOW_ROWS })
const sheet = useAssistantSheet()
// The run and the shared conversation both fetch only while this surface may: a closed sheet stays silent.
function canFetch() { return sheet.shown.value && !disabled.value }
const { runId, status, items, limit, error, unavailable, send, decide, load, reset } = useAiRun({ enabled: canFetch })
const { hidden, toggle: toggleSection } = useAiNowSection()

const disabled = computed(() => !config.public.aiEnabled || unavailable.value)
const streaming = computed(() => status.value === 'streaming')
const composerDisabled = computed(() => !hydrated.value || limit.value === 'messages_monthly' || status.value === 'waiting_user')
const latestPending = computed(() => latestPendingIndex(items.value))
const conversation = computed(() => items.value.length > 0)
const context = computed(() => parseAiContext(assistantContext(route.path, activeModule.value)))
const suggestion = computed(() => rows.value.find(row => row.suggestion)?.suggestion ?? null)
const starters = computed(() => AI_STARTER_KEYS.map(key => t(`ai.starters.${key}`)))
const followUps = computed(() => followUpKeys(context.value?.page ?? null).map(key => t(`ai.followUps.${key}`)))
const showFollowUps = computed(() => !streaming.value && status.value !== 'waiting_user' && items.value.at(-1)?.kind === 'assistant')
const summary = (item: { summaryAr: string; summaryEn: string }) => (locale.value === 'en' ? item.summaryEn : item.summaryAr)

// Follows the conversation the full page (or an earlier visit) has open; its own new run is written back.
// It is kept mounted while closed, so it follows only while shown: reopening it brings the run up to date.
const { startNew } = followSharedConversation({ runId, streaming, load, reset }, canFetch)

async function onSend(text: string) {
  await send(text, context.value)
}

// The draft hand-off is the page's own; a project already created for this draft is finished on the full page.
function openDraft(item: { callId: string; tool: string; payload: Record<string, unknown> }) {
  if (!runId.value) return
  void router.push(readCreatedId(runId.value, item.callId) !== null ? { path: '/ai', query: { run: runId.value } } : prepareDraftHandoff(runId.value, item))
}

// Stay at the bottom while the reader is there, and always after their own message or a reopened run.
const NEAR_BOTTOM_PX = 120
const scroller = ref<HTMLElement | null>(null)
watch(items, async (now, before) => {
  const el = scroller.value
  if (!el) return
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  const follow = atBottom || before.length === 0 || now.at(-1)?.kind === 'user'
  await nextTick()
  if (follow) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col" data-testid="ai-sheet">
    <SharedEmptyState v-if="disabled" :title="t('ai.errors.unavailable')" data-testid="ai-sheet-unavailable" />
    <template v-else>
      <section v-if="nowScope !== null" class="shrink-0 p-3 pb-0" :aria-label="t('ai.sheet.now.title')" data-testid="ai-sheet-now">
        <div class="flex flex-col gap-2 rounded-control bg-muted p-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">{{ t('ai.sheet.now.title') }}</h3>
            <UButton type="button" color="neutral" variant="link" size="xs" class="webvue-touch-target" :label="t(hidden ? 'ai.sheet.now.show' : 'ai.sheet.now.hide')" :aria-expanded="!hidden" data-testid="ai-sheet-now-toggle" @click="toggleSection" />
          </div>
          <template v-if="!hidden">
            <USkeleton v-if="pending" class="h-9 w-full rounded-control" data-testid="ai-sheet-now-skeleton" />
            <template v-else-if="!failed">
              <ul v-if="rows.length" class="flex flex-col gap-1">
                <li v-for="row in rows" :key="row.id">
                  <NuxtLink :to="row.to" class="webvue-touch-target flex items-start gap-2 rounded-control px-1 py-1 text-sm text-highlighted hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary" data-testid="ai-sheet-now-row">
                    <span aria-hidden="true" :class="['mt-2 size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
                    <span v-if="row.tone === 'urgent'" class="sr-only">{{ t('ai.glance.urgent') }}</span>
                    <span class="flex min-w-0 flex-col">
                      <span class="break-words">{{ row.label }}</span>
                      <span v-if="row.caption" class="text-xs text-muted">{{ row.caption }}</span>
                    </span>
                  </NuxtLink>
                </li>
              </ul>
              <p v-else class="text-sm text-muted" data-testid="ai-sheet-now-empty">{{ t('ai.sheet.now.empty') }}</p>
              <div v-if="suggestion" class="rounded-control border border-default bg-default p-3" data-testid="ai-sheet-suggestion">
                <p class="flex items-center gap-2 text-xs font-medium text-muted">
                  <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-primary" />
                  {{ t('ai.suggestionLabel') }}
                </p>
                <p class="mt-1 break-words text-sm text-highlighted">{{ suggestion }}</p>
              </div>
            </template>
          </template>
        </div>
      </section>

      <div class="flex shrink-0 items-center gap-3 px-3 pt-3">
        <h3 class="text-xs font-semibold text-muted">{{ t('ai.sheet.conversation') }}</h3>
        <span class="h-px flex-1 bg-accented" aria-hidden="true" />
        <UButton v-if="conversation" type="button" color="neutral" variant="link" size="xs" class="webvue-touch-target" :label="t('ai.history.new')" data-testid="ai-sheet-new" @click="startNew" />
      </div>

      <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
        <div v-if="limit || error" class="flex flex-col gap-3 px-3 pt-3">
          <AiLimitNotice v-if="limit" :limit="limit" />
          <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
        </div>
        <div v-if="!conversation" class="flex flex-col gap-4 px-3 py-4" data-testid="ai-sheet-empty">
          <div class="flex flex-col items-center gap-2 text-center">
            <AiAvatar />
            <p class="text-sm text-muted">{{ t('ai.prompt') }}</p>
          </div>
          <AiSuggestionChips :items="starters" :label="t('ai.starters.label')" :disabled="composerDisabled" @pick="onSend" />
        </div>
        <div v-else class="flex flex-col gap-4 px-3 py-4" role="log" aria-live="polite">
          <template v-for="(item, index) in items" :key="index">
            <AiMessage v-if="item.kind === 'user'" role="user" compact :text="item.text" />
            <AiMessage v-else-if="item.kind === 'assistant'" role="assistant" compact :text="item.text" :streaming="item.streaming">
              <template #footer>
                <div v-if="item.records.length || (item.text && !item.streaming)" class="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <AiRecordCards v-if="item.records.length" :records="item.records" />
                  <AiCopyButton v-if="item.text && !item.streaming" :text="item.text" />
                </div>
              </template>
            </AiMessage>
            <AiToolTrace v-else-if="item.kind === 'tool'" :summary="summary(item)" :state="item.state" :disabled="!hydrated || streaming" @retry="decide(item.callId, 'approved')" />
            <AiConfirmCard v-else-if="item.kind === 'confirm'" :summary="summary(item)" :state="item.state" :latest="index === latestPending" :disabled="!hydrated || streaming || item.busy" :note="item.busy ? t('ai.confirm.executing') : undefined" @approve="decide(item.callId, 'approved')" @reject="decide(item.callId, 'rejected')" />
            <AiDraftCard v-else :summary="summary(item)" :state="item.state" :latest="index === latestPending" @open="openDraft(item)" @discard="decide(item.callId, 'rejected')" />
          </template>
        </div>
      </div>

      <div class="flex shrink-0 flex-col gap-2 bg-default p-3">
        <AiSuggestionChips v-if="conversation && showFollowUps" :items="followUps" :label="t('ai.followUps.label')" :disabled="composerDisabled" @pick="onSend" />
        <AiComposer compact :disabled="composerDisabled" :pending="streaming" @send="onSend" />
        <p class="flex items-center gap-2 text-xs text-muted">
          <UIcon name="i-lucide-shield-check" aria-hidden="true" class="size-4 shrink-0" />
          <span>{{ t('ai.note') }}</span>
        </p>
      </div>
    </template>
  </div>
</template>
