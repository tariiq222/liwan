<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiAvatar from '@/components/ai/AiAvatar.vue'
import AiContextChip from '@/components/ai/AiContextChip.vue'
import AiCopyButton from '@/components/ai/AiCopyButton.vue'
import AiSuggestionChips from '@/components/ai/AiSuggestionChips.vue'
import AiConfirmCard from '@/components/ai/AiConfirmCard.vue'
import AiDraftCard from '@/components/ai/AiDraftCard.vue'
import AiRunList from '@/components/ai/AiRunList.vue'
import AiLimitNotice from '@/components/ai/AiLimitNotice.vue'
import AiMessage from '@/components/ai/AiMessage.vue'
import AiRecordCards from '@/components/ai/AiRecordCards.vue'
import AiToolTrace from '@/components/ai/AiToolTrace.vue'
import { useAiRun } from '@/composables/useAiRun'
import { useAttention } from '@/composables/useAttention'
import { useAiConversation } from '@/composables/useAiConversation'
import { aiRunKeys, useAiRuns } from '@/composables/useAiRuns'
import { latestPendingIndex } from '@/utils/aiThread'
import { AI_STARTER_KEYS, followUpKeys } from '@/utils/aiSuggestions'
import { parseAiContext } from '@/utils/aiContext'
import { forgetCreatedId, parseCreatedId, prepareDraftHandoff, readCreatedId, rememberCreatedId } from '@/utils/aiDraft'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const config = useRuntimeConfig()
const { runId, status, items, limit, error, unavailable, send, decide, load, reset } = useAiRun()
const queryClient = useQueryClient()
const { me } = useMe()
const { rows: attentionRows } = useAttention('all', { limit: 3 })
const { data: runList } = useAiRuns(false)
const { currentRunId } = useAiConversation()

const disabledByConfig = computed(() => !config.public.aiEnabled)
const showUnavailable = computed(() => disabledByConfig.value || unavailable.value)

// Below 768px the shell drops the sidebar panel, so the same AiRunList is offered here as an inline disclosure.
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })

// `?context=project:12` comes from the page the user opened the assistant from.
const context = computed(() => parseAiContext(route.query.context))
const streaming = computed(() => status.value === 'streaming')
// A pending card is answered before another message: the service holds one pending call per run.
const composerDisabled = computed(() => !hydrated.value || limit.value === 'messages_monthly' || status.value === 'waiting_user')
// Only the newest pending confirm/draft card is the page's one `action` block (DESIGN.md); older pending ones are tinted.
const latestPending = computed(() => latestPendingIndex(items.value))
const conversation = computed(() => items.value.length > 0)
const firstName = computed(() => me.value?.name.trim().split(/\s+/)[0] ?? '')
// The open run's name as the history list shows it; a run not in the list yet (just started, or archived) is named by its first question.
const runTitle = computed(() => {
  const listed = runList.value?.items.find(run => run.run_id === runId.value)?.title
  const firstQuestion = items.value.find(item => item.kind === 'user')
  return listed ?? (firstQuestion?.kind === 'user' ? firstQuestion.text : t('ai.history.untitled'))
})
const starters = computed(() => AI_STARTER_KEYS.map(key => t(`ai.starters.${key}`)))
const followUps = computed(() => followUpKeys(context.value?.page ?? null).map(key => t(`ai.followUps.${key}`)))
// Follow-ups follow the newest finished reply; while an answer streams or a card waits for a decision there is nothing to ask next.
const showFollowUps = computed(() => !streaming.value && status.value !== 'waiting_user' && items.value.at(-1)?.kind === 'assistant')

// The thread scrolls inside the card: stay at the bottom while the reader is there, and always after their own message or a reopened run.
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
const summary = (item: { summaryAr: string; summaryEn: string }) => (locale.value === 'en' ? item.summaryEn : item.summaryAr)

// Reopen a run by link/refresh; a `resume` query means the create page finished (or left) a draft.
onMounted(async () => {
  if (disabledByConfig.value) return
  // Without `?run=` the conversation the sheet has open continues here.
  const id = typeof route.query.run === 'string' ? route.query.run : currentRunId.value
  if (!id) return
  const resume = typeof route.query.resume === 'string' ? route.query.resume : null
  const created = parseCreatedId(route.query.created)
  // Kept before anything can fail, until the decision reaches the server: a failed load or decide cannot lose the project.
  if (resume && created !== null) rememberCreatedId(id, resume, created)
  await load(id)
  // The query goes first, so a refresh during the answer cannot resume a second time.
  if (resume) {
    const { resume: _resume, created: _created, ...rest } = route.query
    await router.replace({ path: '/ai', query: rest })
  }
  // A draft whose project already exists is finished with it, never opened again.
  const finished = items.value.find(item => item.kind === 'draft' && item.state === 'pending' && readCreatedId(id, item.callId) !== null)
  const callId = resume ?? (finished && 'callId' in finished ? finished.callId : null)
  if (callId) await resumeDraft(id, callId, resume !== null)
})

async function resumeDraft(id: string, callId: string, cancellable: boolean) {
  // One resume only: the service accepts a pending call_id once (a second call answers 409).
  const card = items.value.find(item => item.kind === 'draft' && item.callId === callId)
  if (!runId.value || card?.kind !== 'draft' || card.state !== 'pending') return
  const createdId = readCreatedId(id, callId)
  // Leaving the create page without a project is a rejection; a remembered id without that query is only a retry of the approval.
  if (createdId === null && !cancellable) return
  const accepted = await decide(callId, createdId === null ? 'rejected' : 'approved', createdId === null ? undefined : { id: createdId })
  if (accepted) forgetCreatedId(id, callId)
}

function openDraft(item: { callId: string; tool: string; payload: Record<string, unknown> }) {
  if (!runId.value) return
  // The project of this draft already exists (an earlier decision failed): finish that, do not create another.
  if (readCreatedId(runId.value, item.callId) !== null) {
    void resumeDraft(runId.value, item.callId, false)
    return
  }
  void router.push(prepareDraftHandoff(runId.value, item))
}

async function onSend(text: string) {
  await send(text, context.value)
}

// The address follows the conversation as soon as the service names it, so a new-conversation click always changes the route.
watch(runId, async (id) => {
  // Leaving the page empties its own run; the shared conversation (the sheet's) must survive that.
  if (route.path !== '/ai') return
  currentRunId.value = id
  if (id && route.query.run !== id) await router.replace({ path: '/ai', query: { ...route.query, run: id } })
})

// The history list opens another conversation or starts a new one by changing `?run=` (back/forward do the same).
watch(() => route.query.run, async (value) => {
  // Navigating away drops the query too: that is not "start a new conversation".
  if (route.path !== '/ai') return
  const id = typeof value === 'string' ? value : null
  if (id === runId.value) return
  reset()
  if (id) await load(id)
})

// A conversation that was created, answered or decided changes the history list: fetch it again once the stream settles.
watch(status, (now, before) => {
  if (before === 'streaming' && now !== 'streaming') void queryClient.invalidateQueries({ queryKey: aiRunKeys.all })
})
</script>

<template>
  <SharedPageContainer width="full" data-template="ai-conversation">
    <h1 class="sr-only">{{ t('ai.title') }}</h1>
    <AiRunList v-if="!showUnavailable && !isDesktop" disclosure />
    <SharedListCard fill class="max-md:h-[75svh]">
      <SharedEmptyState v-if="showUnavailable" :title="t('ai.errors.unavailable')" data-testid="ai-unavailable" />
      <template v-else>
        <header v-if="conversation" class="flex shrink-0 items-center gap-3 border-b border-default px-4 py-3" data-testid="ai-topbar">
          <h2 dir="auto" class="min-w-0 truncate text-sm font-semibold text-highlighted">{{ runTitle }}</h2>
          <AiContextChip v-if="context" :page="context.page" />
        </header>
        <div v-if="limit || error" class="mx-auto flex w-full max-w-180 shrink-0 flex-col gap-3 px-4 pt-3">
          <AiLimitNotice v-if="limit" :limit="limit" />
          <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
        </div>
        <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
          <div v-if="!conversation" class="mx-auto flex min-h-full w-full max-w-180 flex-col justify-center gap-7 px-4 py-8" data-testid="ai-empty">
            <div class="flex flex-col items-center gap-3 text-center">
              <AiAvatar size="lg" />
              <h2 class="text-2xl font-bold text-highlighted">{{ firstName ? t('ai.greeting', { name: firstName }) : t('ai.greetingAnonymous') }}</h2>
              <p class="text-base text-muted">{{ t('ai.prompt') }}</p>
              <AiContextChip v-if="context" :page="context.page" />
            </div>
            <AiComposer :disabled="composerDisabled" :pending="streaming" @send="onSend" />
            <section v-if="attentionRows.length" :aria-label="t('ai.glance.title')" class="flex flex-col gap-3" data-testid="ai-glance">
              <h3 class="text-sm font-semibold text-highlighted">{{ t('ai.glance.title') }}</h3>
              <ul class="grid gap-3 sm:grid-cols-3">
                <li v-for="row in attentionRows" :key="row.id">
                  <NuxtLink :to="row.to" class="flex h-full flex-col gap-1 rounded-control bg-default p-3 ring ring-default hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary" data-testid="ai-glance-tile">
                    <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                      <span aria-hidden="true" :class="['size-2 shrink-0 rounded-full', row.tone === 'urgent' ? 'bg-warning' : 'bg-primary']" />
                      <span v-if="row.tone === 'urgent'" class="sr-only">{{ t('ai.glance.urgent') }}</span>
                      <span class="min-w-0 break-words">{{ row.label }}</span>
                    </span>
                    <span v-if="row.caption" class="text-xs text-muted">{{ row.caption }}</span>
                  </NuxtLink>
                </li>
              </ul>
            </section>
            <AiSuggestionChips :items="starters" :label="t('ai.starters.label')" :disabled="composerDisabled" @pick="onSend" />
            <p class="flex items-center justify-center gap-2 text-center text-xs text-muted">
              <UIcon name="i-lucide-shield-check" aria-hidden="true" class="size-4 shrink-0" />
              <span>{{ t('ai.note') }}</span>
            </p>
          </div>
          <div v-else class="mx-auto flex w-full max-w-180 flex-col gap-5 px-4 py-6" role="log" aria-live="polite">
            <template v-for="(item, index) in items" :key="index">
              <AiMessage v-if="item.kind === 'user'" role="user" :text="item.text" />
              <AiMessage v-else-if="item.kind === 'assistant'" role="assistant" :text="item.text" :streaming="item.streaming">
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
        <div v-if="conversation" class="shrink-0 bg-default px-4 pb-4 pt-2">
          <div class="mx-auto flex w-full max-w-180 flex-col gap-3">
            <AiSuggestionChips v-if="showFollowUps" :items="followUps" :label="t('ai.followUps.label')" :disabled="composerDisabled" @pick="onSend" />
            <AiComposer :disabled="composerDisabled" :pending="streaming" @send="onSend" />
          </div>
        </div>
      </template>
    </SharedListCard>
  </SharedPageContainer>
</template>
