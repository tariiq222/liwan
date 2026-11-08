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
import type { AiConversationMode } from '@liwan/contracts'
import { isBlockingLimit, useAiRun } from '@/composables/useAiRun'
import { useAttention } from '@/composables/useAttention'
import { useAiConversation } from '@/composables/useAiConversation'
import { aiRunKeys, useAiRuns } from '@/composables/useAiRuns'
import { latestPendingIndex } from '@/utils/aiThread'
import { AI_HELP_STARTER_KEYS, AI_STARTER_KEYS, followUpKeys } from '@/utils/aiSuggestions'
import { parseAiContext } from '@/utils/aiContext'
import { forgetCreatedId, parseCreatedId, prepareDraftHandoff, readCreatedId, rememberCreatedId } from '@/utils/aiDraft'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const config = useRuntimeConfig()
const { runId, mode: runMode, status, items, limit, error, unavailable, send, decide, load, reset } = useAiRun()
const queryClient = useQueryClient()
const { me } = useMe()
const { rows: attentionRows } = useAttention('all', { limit: 3 })
const { data: runList } = useAiRuns(false)
const { currentRunId } = useAiConversation()
const identity = computed(() => me.value ? `${me.value.company.id}:${me.value.id}` : null)

const disabledByConfig = computed(() => !config.public.aiEnabled)
const showUnavailable = computed(() => disabledByConfig.value || unavailable.value)

// From 1024px the history is a pane beside the conversation; below it the same AiRunList is an inline disclosure above it.
const isWide = useMediaQuery('(min-width: 1024px)', { ssrWidth: 1280 })

// `?context=project:12` comes from the page the user opened the assistant from.
const context = computed(() => parseAiContext(route.query.context))
// `?mode=setup` (from the AI settings) or `?mode=help` (from the help entries) chooses the mode of a NEW conversation only.
const queryMode = computed<AiConversationMode | null>(() => (route.query.mode === 'setup' || route.query.mode === 'help' ? route.query.mode : null))
// An open conversation (or one opened by `?run=`) keeps the mode it started in, which the server reports: the URL cannot change it.
const mode = computed<AiConversationMode | null>(() => {
  if (runId.value === null && typeof route.query.run !== 'string') return queryMode.value
  return runMode.value === 'setup' || runMode.value === 'help' ? runMode.value : null
})
// The help entry keeps the page the assistant was opened from, so the help agent knows which page is meant.
const helpTo = computed(() => ({ path: '/ai', query: { mode: 'help', ...(typeof route.query.context === 'string' ? { context: route.query.context } : {}) } }))
const streaming = computed(() => status.value === 'streaming')
// A pending card is answered before another message: the service holds one pending call per run.
const composerDisabled = computed(() => !hydrated.value || isBlockingLimit(limit.value) || status.value === 'waiting_user')
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
const starters = computed(() => mode.value === 'help' ? AI_HELP_STARTER_KEYS.map(key => t(`ai.helpStarters.${key}`)) : AI_STARTER_KEYS.map(key => t(`ai.starters.${key}`)))
const followUps = computed(() => followUpKeys(context.value?.page ?? null).map(key => t(`ai.followUps.${key}`)))
// Follow-ups follow the newest finished reply; while an answer streams or a card waits for a decision there is nothing to ask next.
// A help conversation reads the guide, not the company's records: the follow-ups about tasks and projects do not apply.
const showFollowUps = computed(() => mode.value !== 'help' && !streaming.value && status.value !== 'waiting_user' && items.value.at(-1)?.kind === 'assistant')

// The thread scrolls inside its card: stay at the bottom while the reader is there, and always after their own message or a reopened run.
const NEAR_BOTTOM_PX = 120
const scroller = ref<HTMLElement | null>(null)
watch(items, async (now, before) => {
  // The thread card exists only once there is a conversation, so its first messages are followed after it mounts.
  const el = scroller.value
  const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
  const follow = atBottom || before.length === 0 || now.at(-1)?.kind === 'user'
  await nextTick()
  if (follow && scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
})
const summary = (item: { summaryAr: string; summaryEn: string }) => (locale.value === 'en' ? item.summaryEn : item.summaryAr)

// The route loader owns opening runs; ending the shared conversation or changing identity
// must also clear this page's local transcript, including a load not yet published as a run id.
watch([identity, currentRunId], ([owner, id], [beforeOwner]) => {
  if (owner === beforeOwner && id !== null) return
  reset()
  if (route.path !== '/ai') return
  const { run: _run, resume: _resume, created: _created, ...query } = route.query
  if (_run !== undefined || _resume !== undefined || _created !== undefined) void router.replace({ path: '/ai', query })
}, { flush: 'sync' })

// Reopen a run by link/refresh; a `resume` query means the create page finished (or left) a draft.
onMounted(async () => {
  if (disabledByConfig.value) return
  // Without `?run=` the conversation the sheet has open continues here, except that a free agent always starts
  // a conversation of its own (an ordinary one would keep its mode and never offer that agent's tools).
  if (queryMode.value && typeof route.query.run !== 'string') currentRunId.value = null
  const id = typeof route.query.run === 'string' ? route.query.run : currentRunId.value
  if (!id) return
  const owner = identity.value
  const resume = typeof route.query.resume === 'string' ? route.query.resume : null
  const created = parseCreatedId(route.query.created)
  // Kept before anything can fail, until the decision reaches the server: a failed load or decide cannot lose the project.
  if (resume && created !== null) rememberCreatedId(id, resume, created)
  await load(id)
  if (identity.value !== owner || runId.value !== id) return
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
  await send(text, context.value, mode.value ?? undefined)
}

// The address follows the conversation as soon as the service names it, so a new-conversation click always changes the route.
watch(runId, async (id) => {
  // Leaving the page empties its own run; the shared conversation (the sheet's) must survive that.
  if (route.path !== '/ai') return
  if (id) currentRunId.value = id
  if (id && route.query.run !== id) await router.replace({ path: '/ai', query: { ...route.query, run: id } })
}, { flush: 'sync' })

// Opening a free agent while this page is already shown starts a fresh conversation with it.
watch(queryMode, (now) => {
  if (now && typeof route.query.run !== 'string') currentRunId.value = null
})

// The history list opens another conversation or starts a new one by changing `?run=` (back/forward do the same).
watch(() => route.query.run, async (value) => {
  // Navigating away drops the query too: that is not "start a new conversation".
  if (route.path !== '/ai') return
  const id = typeof value === 'string' ? value : null
  if (id === null) {
    currentRunId.value = null
    reset()
    return
  }
  if (id === runId.value) return
  reset()
  await load(id)
})

// A conversation that was created, answered or decided changes the history list: fetch it again once the stream settles.
watch(status, (now, before) => {
  if (before === 'streaming' && now !== 'streaming') void queryClient.invalidateQueries({ queryKey: aiRunKeys.all })
})
</script>

<template>
  <SharedPageContainer data-template="ai-conversation">
    <SharedPageHeader :title="t('ai.title')" />
    <SharedEmptyState v-if="showUnavailable" bordered :title="t('ai.errors.unavailable')" data-testid="ai-unavailable" />
    <template v-else>
      <AiRunList v-if="!isWide" disclosure />
      <div class="grid min-w-0 items-start gap-4" :class="{ 'grid-cols-[minmax(0,1fr)_320px]': isWide }">
        <div class="flex min-w-0 flex-col gap-4">
          <p v-if="mode" class="flex items-center gap-2 rounded-control bg-elevated px-4 py-2 text-sm text-muted" :data-testid="`ai-${mode}-banner`">
            <UIcon :name="mode === 'help' ? 'i-lucide-circle-help' : 'i-lucide-wand-sparkles'" aria-hidden="true" class="size-4 shrink-0" />
            <span>{{ t(`ai.${mode}.banner`) }}</span>
          </p>
          <div v-if="limit || error" class="flex w-full flex-col gap-3">
            <AiLimitNotice v-if="limit" :limit="limit" />
            <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
          </div>
          <div v-if="!conversation" class="flex min-w-0 flex-col gap-4" data-testid="ai-empty">
            <AiContextChip v-if="context" :page="context.page" />
            <AiComposer :disabled="composerDisabled" :pending="streaming" @send="onSend">
              <AiSuggestionChips :items="starters" :label="t('ai.starters.label')" :disabled="composerDisabled" @pick="onSend" />
            </AiComposer>
            <section v-if="!mode && attentionRows.length" :aria-label="t('ai.glance.title')" class="flex flex-col gap-3" data-testid="ai-glance">
              <h3 class="text-sm font-semibold text-highlighted">{{ t('ai.glance.title') }}</h3>
              <ul class="liwan-auto-grid gap-3">
                <li v-for="row in attentionRows" :key="row.id">
                  <NuxtLink :to="row.to" class="flex h-full flex-col gap-1 rounded-card border-[1.5px] border-default bg-default p-3 transition-colors hover:bg-elevated focus-visible:ring-2 focus-visible:ring-primary" data-testid="ai-glance-tile">
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
            <div class="grid justify-items-center gap-2.5 rounded-surface border-[1.5px] border-dashed border-default bg-default px-5 py-14 text-center">
              <AiAvatar size="lg" />
              <h2 class="mt-2 font-display text-xl font-bold text-highlighted">{{ firstName ? t('ai.greeting', { name: firstName }) : t('ai.greetingAnonymous') }}</h2>
              <p class="max-w-105 text-sm text-muted">{{ t('ai.prompt') }}</p>
              <p class="flex max-w-105 items-center justify-center gap-2 text-center text-xs text-muted">
                <UIcon name="i-lucide-shield-check" aria-hidden="true" class="size-4 shrink-0" />
                <span>{{ t('ai.note') }}</span>
              </p>
              <div v-if="!mode" class="flex justify-center" data-testid="ai-help-entry">
                <UButton :to="helpTo" color="neutral" variant="soft" icon="i-lucide-circle-help" :label="t(context ? 'ai.help.askPage' : 'ai.help.open')" data-testid="ai-help-open" />
              </div>
            </div>
          </div>
          <div v-else class="flex h-[max(480px,calc(100svh-300px))] min-h-0 min-w-0 flex-col overflow-hidden rounded-surface border-[1.5px] border-default bg-default">
            <header class="flex shrink-0 items-center gap-3 border-b-[1.5px] border-default px-5 py-3" data-testid="ai-topbar">
              <h2 dir="auto" class="min-w-0 truncate text-sm font-semibold text-highlighted">{{ runTitle }}</h2>
              <AiContextChip v-if="context" :page="context.page" />
            </header>
            <div ref="scroller" class="min-h-0 flex-1 overflow-y-auto">
              <div class="mx-auto flex w-full max-w-180 flex-col gap-5 px-4 py-6" role="log" aria-live="polite">
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
                  <AiHandoffLine v-else-if="item.kind === 'agent'" :name="locale === 'en' ? item.nameEn : item.nameAr" />
                  <AiToolTrace v-else-if="item.kind === 'tool'" :summary="summary(item)" :state="item.state" :disabled="!hydrated || streaming" @retry="decide(item.callId, 'approved')" />
                  <AiConfirmCard v-else-if="item.kind === 'confirm'" :summary="summary(item)" :state="item.state" :latest="index === latestPending" :disabled="!hydrated || streaming || item.busy" :note="item.busy ? t('ai.confirm.executing') : undefined" @approve="decide(item.callId, 'approved')" @reject="decide(item.callId, 'rejected')" />
                  <AiDraftCard v-else :summary="summary(item)" :state="item.state" :latest="index === latestPending" @open="openDraft(item)" @discard="decide(item.callId, 'rejected')" />
                </template>
              </div>
            </div>
            <div class="shrink-0 border-t-[1.5px] border-default bg-default px-4 pb-4 pt-3">
              <div class="mx-auto flex w-full max-w-180 flex-col gap-3">
                <AiSuggestionChips v-if="showFollowUps" :items="followUps" :label="t('ai.followUps.label')" :disabled="composerDisabled" @pick="onSend" />
                <AiComposer compact :disabled="composerDisabled" :pending="streaming" @send="onSend" />
              </div>
            </div>
          </div>
        </div>
        <aside v-if="isWide" :aria-label="t('ai.history.title')">
          <AiRunList />
        </aside>
      </div>
    </template>
  </SharedPageContainer>
</template>
