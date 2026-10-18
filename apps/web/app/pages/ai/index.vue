<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { useQueryClient } from '@tanstack/vue-query'
import { AiDraftHandoffSchema, AiDraftPayloadSchema } from '@webvue/contracts'
import AiComposer from '@/components/ai/AiComposer.vue'
import AiConfirmCard from '@/components/ai/AiConfirmCard.vue'
import AiDraftCard from '@/components/ai/AiDraftCard.vue'
import AiRunList from '@/components/ai/AiRunList.vue'
import AiLimitNotice from '@/components/ai/AiLimitNotice.vue'
import AiMessage from '@/components/ai/AiMessage.vue'
import AiRecordCards from '@/components/ai/AiRecordCards.vue'
import AiToolTrace from '@/components/ai/AiToolTrace.vue'
import { useAiRun } from '@/composables/useAiRun'
import { aiRunKeys } from '@/composables/useAiRuns'
import { latestPendingIndex } from '@/utils/aiThread'
import { forgetCreatedId, parseCreatedId, readCreatedId, rememberCreatedId } from '@/utils/aiDraft'

const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()
const hydrated = useHydrated()
const config = useRuntimeConfig()
const { runId, status, items, limit, error, unavailable, send, decide, load, reset } = useAiRun()
const queryClient = useQueryClient()

const disabledByConfig = computed(() => !config.public.aiEnabled)
const showUnavailable = computed(() => disabledByConfig.value || unavailable.value)

// Below 768px the shell drops the sidebar panel, so the same AiRunList is offered here as an inline disclosure.
const isDesktop = useMediaQuery('(min-width: 768px)', { ssrWidth: 1024 })

// `?context=project:12` comes from the page the user opened the assistant from.
const context = computed(() => {
  const raw = typeof route.query.context === 'string' ? route.query.context : ''
  const match = raw.match(/^([a-z]+)(?::(\d+))?$/)
  return match ? { page: match[1]!, id: match[2] ? Number(match[2]) : null } : null
})
const streaming = computed(() => status.value === 'streaming')
// A pending card is answered before another message: the service holds one pending call per run.
const composerDisabled = computed(() => !hydrated.value || limit.value === 'messages_monthly' || status.value === 'waiting_user')
// Only the newest pending confirm/draft card is the page's one `action` block (DESIGN.md); older pending ones are tinted.
const latestPending = computed(() => latestPendingIndex(items.value))
const summary = (item: { summaryAr: string; summaryEn: string }) => (locale.value === 'en' ? item.summaryEn : item.summaryAr)

// Reopen a run by link/refresh; a `resume` query means the create page finished (or left) a draft.
onMounted(async () => {
  if (disabledByConfig.value) return
  const id = typeof route.query.run === 'string' ? route.query.run : null
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
  const draftId = `${runId.value}:${item.callId}`
  const base = { run_id: runId.value, call_id: item.callId, tool: item.tool }
  // The create page is the validation boundary: a payload without a usable name still opens the form, empty.
  const parsed = AiDraftHandoffSchema.safeParse({ ...base, payload: item.payload })
  const handoff = parsed.success ? parsed.data : { ...base, payload: AiDraftPayloadSchema.partial().safeParse(item.payload).data ?? {} }
  try { sessionStorage.setItem(`webvue:ai-draft:${draftId}`, JSON.stringify(handoff)) } catch { /* private mode: the page still opens empty */ }
  void router.push({ path: '/projects/new', query: { aiDraft: draftId, returnTo: `/ai?run=${runId.value}&resume=${item.callId}` } })
}

async function onSend(text: string) {
  await send(text, context.value)
}

// The address follows the conversation as soon as the service names it, so a new-conversation click always changes the route.
watch(runId, async (id) => {
  if (id && route.query.run !== id) await router.replace({ path: '/ai', query: { ...route.query, run: id } })
})

// The history list opens another conversation or starts a new one by changing `?run=` (back/forward do the same).
watch(() => route.query.run, async (value) => {
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
  <SharedPageContainer width="detail" data-template="ai-conversation">
    <SharedPageHeader :title="t('ai.title')" :description="t('ai.tagline')" />
    <AiRunList v-if="!showUnavailable && !isDesktop" disclosure />
    <SharedEmptyState v-if="showUnavailable" :title="t('ai.errors.unavailable')" data-testid="ai-unavailable" />
    <section v-else class="flex min-h-[60svh] flex-col gap-4" :aria-label="t('ai.title')">
      <SharedRecordSection variant="panel" class="flex-1">
        <div class="flex flex-col gap-4" role="log" aria-live="polite">
          <SharedEmptyState v-if="items.length === 0" :title="t('ai.thread.empty')" :description="t('ai.description')" data-testid="ai-empty" />
          <template v-for="(item, index) in items" :key="index">
            <AiMessage v-if="item.kind === 'user'" role="user" :text="item.text" />
            <template v-else-if="item.kind === 'assistant'">
              <AiMessage role="assistant" :text="item.text" :streaming="item.streaming" />
              <AiRecordCards v-if="item.records.length" :records="item.records" />
            </template>
            <AiToolTrace v-else-if="item.kind === 'tool'" :summary="summary(item)" :state="item.state" :disabled="!hydrated || streaming" @retry="decide(item.callId, 'approved')" />
            <AiConfirmCard v-else-if="item.kind === 'confirm'" :summary="summary(item)" :state="item.state" :latest="index === latestPending" :disabled="!hydrated || streaming || item.busy" :note="item.busy ? t('ai.confirm.executing') : undefined" @approve="decide(item.callId, 'approved')" @reject="decide(item.callId, 'rejected')" />
            <AiDraftCard v-else :summary="summary(item)" :state="item.state" :latest="index === latestPending" @open="openDraft(item)" @discard="decide(item.callId, 'rejected')" />
          </template>
        </div>
      </SharedRecordSection>
      <AiLimitNotice v-if="limit" :limit="limit" />
      <UAlert v-if="error" role="alert" color="error" variant="subtle" icon="i-lucide-circle-alert" :title="error" />
      <SharedRecordSection variant="panel" class="sticky bottom-4 z-10">
        <AiComposer :disabled="composerDisabled" :pending="streaming" @send="onSend" />
      </SharedRecordSection>
    </section>
  </SharedPageContainer>
</template>
