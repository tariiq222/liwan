<script setup lang="ts">
import { formatDate, formatTime } from '@webvue/ui/app/utils/formatDate'
import { AI_RUN_TITLE_MAX_CHARS, AiRunPatchSchema, type AiRunSummary } from '@webvue/contracts'
import { ApiError } from '@/composables/useApi'
import { useAiRunActions, useAiRuns } from '@/composables/useAiRuns'

// The AI manifest's context-sidebar panel (AppManifest.sidebarPanel): the user's own conversations beside the open thread; below 768px
// the /ai page mounts this same component with `disclosure`: a toggle that opens the list inline (never an overlay) and closes
// again when a conversation or "new" is chosen.
// The selected one is the `?run=` of the route; the page reacts to the route, so the rows only link. A row can be renamed in
// place or archived (both reversible); the archived ones are one toggle away and an open conversation stays open when archived.
const props = defineProps<{ disclosure?: boolean }>()
const route = useRoute()
const { t } = useI18n()
const toast = useToast()
const hydrated = useHydrated()
const showArchived = ref(false)
const { data, isLoading, isError, error, refetch } = useAiRuns(showArchived)
const { rename, setArchived } = useAiRunActions()
const items = computed(() => data.value?.items ?? [])
const open = ref(false)
const expanded = computed(() => !props.disclosure || open.value)
const closeOnNavigate = (event: MouseEvent) => {
  if (props.disclosure && (event.target as HTMLElement).closest('a')) open.value = false
}
const selectedId = computed(() => (typeof route.query.run === 'string' ? route.query.run : null))

const isToday = (value: string) => new Date(value).toDateString() === new Date().toDateString()
const shortDate = (run: AiRunSummary) => (isToday(run.updated_at) ? formatTime(run.updated_at) : formatDate(run.updated_at))
const hint = (run: AiRunSummary) => (run.status === 'waiting_user' ? t('ai.history.waiting') : run.status === 'failed' ? t('ai.history.failed') : null)
const titleOf = (run: AiRunSummary) => run.title ?? t('ai.history.untitled')

const announcement = ref('')
const views = computed(() => [
  { archived: false, label: t('ai.history.views.active'), testId: 'ai-view-active' },
  { archived: true, label: t('ai.history.views.archived'), testId: 'ai-view-archived' },
])

const failure = (e: unknown) => (e instanceof ApiError ? e.message : t('errors.generic'))

async function toggleArchived(run: AiRunSummary) {
  try {
    await setArchived(run.run_id, !run.archived)
    announcement.value = t(run.archived ? 'ai.history.announce.unarchived' : 'ai.history.announce.archived')
  } catch (e) {
    toast.add({ title: failure(e), color: 'error' })
  }
}

const editingId = ref<string | null>(null)
const draft = ref('')
const renameError = ref('')
const saving = ref(false)
let editor: { inputRef?: HTMLInputElement | null } | null = null // a ref inside v-for: only the open editor is kept
const bindEditor = (el: unknown) => { editor = el as typeof editor }

async function startRename(run: AiRunSummary) {
  editingId.value = run.run_id
  draft.value = run.title ?? ''
  renameError.value = ''
  // The row menu hands focus back to its button as it closes; take it for the input after that.
  await nextTick()
  setTimeout(() => { editor?.inputRef?.focus(); editor?.inputRef?.select() }, 0)
}

function cancelRename() {
  editingId.value = null
  renameError.value = ''
}

/** Enter and blur save; an unchanged name just closes the editor, an invalid or refused one keeps it open with the reason beside it. */
async function commitRename(run: AiRunSummary) {
  if (editingId.value !== run.run_id || saving.value) return
  const title = draft.value.trim()
  if (title === (run.title ?? '')) return cancelRename()
  if (!AiRunPatchSchema.safeParse({ title }).success) {
    renameError.value = t('ai.history.rename.invalid', { max: AI_RUN_TITLE_MAX_CHARS })
    return
  }
  saving.value = true
  try {
    await rename(run.run_id, title)
    announcement.value = t('ai.history.announce.renamed')
    cancelRename()
  } catch (e) {
    renameError.value = failure(e)
  } finally {
    saving.value = false
  }
}

const actionsOf = (run: AiRunSummary) => [
  { label: t('ai.history.actions.rename'), icon: 'i-lucide-pencil' as const, onSelect: () => startRename(run) },
  run.archived
    ? { label: t('ai.history.actions.unarchive'), icon: 'i-lucide-archive-restore' as const, onSelect: () => toggleArchived(run) }
    : { label: t('ai.history.actions.archive'), icon: 'i-lucide-archive' as const, onSelect: () => toggleArchived(run) },
]
</script>

<template>
  <section
    :class="disclosure ? 'rounded-control ring ring-default' : 'flex h-full min-h-0 flex-col'"
    data-testid="ai-run-list"
    :aria-label="t('ai.history.title')"
  >
    <UButton
      v-if="disclosure"
      type="button"
      block
      color="neutral"
      variant="ghost"
      size="lg"
      class="min-h-[44px] justify-between"
      icon="i-lucide-messages-square"
      :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
      :label="t('ai.history.title')"
      :aria-expanded="open"
      aria-controls="ai-run-list-body"
      data-testid="ai-history-toggle"
      @click="open = !open"
    />
    <h2 v-else class="px-4 pt-3 text-sm font-semibold text-highlighted">{{ t('ai.history.title') }}</h2>
    <div
      v-if="expanded"
      id="ai-run-list-body"
      :class="['flex min-h-0 flex-col', disclosure ? 'h-[min(26rem,60svh)] border-t border-default' : 'flex-1']"
      data-testid="ai-run-list-body"
      @click="closeOnNavigate"
    >
      <div class="flex flex-col gap-2 p-3">
        <UButton to="/ai" block color="neutral" variant="soft" class="max-md:min-h-[44px]" icon="i-lucide-plus" :label="t('ai.history.new')" data-testid="ai-new-run" />
        <div role="group" :aria-label="t('ai.history.views.label')" class="grid grid-cols-2 gap-0.5 rounded-md bg-elevated/40 p-0.5 ring ring-default">
          <UButton
            v-for="view in views"
            :key="view.testId"
            type="button"
            color="neutral"
            size="sm"
            block
            class="max-md:min-h-[44px]"
            :variant="view.archived === showArchived ? 'soft' : 'ghost'"
            :label="view.label"
            :aria-pressed="view.archived === showArchived"
            :disabled="!hydrated"
            :data-testid="view.testId"
            @click="showArchived = view.archived"
          />
        </div>
      </div>
      <p class="sr-only" role="status" data-testid="ai-run-announcement">{{ announcement }}</p>
      <SharedPageState
        :loading="!hydrated || isLoading"
        :error="isError ? error : undefined"
        :empty="!items.length"
        :empty-text="showArchived ? t('ai.history.emptyArchived') : t('ai.history.empty')"
        @retry="refetch()"
      >
        <ul class="min-h-0 flex-1 overflow-y-auto">
          <li v-for="run in items" :key="run.run_id" class="flex items-start">
            <form v-if="editingId === run.run_id" class="flex min-w-0 flex-1 flex-col gap-1 px-4 py-2.5" data-testid="ai-run-rename" @submit.prevent="commitRename(run)">
              <UInput
                :ref="bindEditor"
                v-model="draft"
                size="sm"
                dir="auto"
                :maxlength="AI_RUN_TITLE_MAX_CHARS"
                :readonly="saving"
                :aria-label="t('ai.history.rename.label')"
                :aria-invalid="Boolean(renameError)"
                :aria-describedby="renameError ? `ai-rename-error-${run.run_id}` : undefined"
                data-testid="ai-run-rename-input"
                @keydown.esc.prevent="cancelRename"
                @blur="commitRename(run)"
              />
              <p v-if="renameError" :id="`ai-rename-error-${run.run_id}`" role="alert" class="text-xs text-error" data-testid="ai-run-rename-error">{{ renameError }}</p>
            </form>
            <template v-else>
              <NuxtLink
                :to="{ path: '/ai', query: { run: run.run_id } }"
                class="flex min-w-0 flex-1 flex-col gap-0.5 px-4 py-2.5 text-start hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary data-[selected=true]:bg-elevated"
                :data-selected="run.run_id === selectedId"
                :aria-current="run.run_id === selectedId ? 'page' : undefined"
                data-testid="ai-run-item"
              >
                <span dir="auto" class="truncate text-sm font-medium text-highlighted">{{ titleOf(run) }}</span>
                <span class="flex items-center justify-between gap-2 text-xs text-muted">
                  <time :datetime="run.updated_at">{{ shortDate(run) }}</time>
                  <span v-if="hint(run)" :class="run.status === 'failed' ? 'text-error' : 'text-warning'">{{ hint(run) }}</span>
                </span>
              </NuxtLink>
              <div class="shrink-0 pe-2 pt-1.5 max-md:self-center max-md:pt-0 max-md:[&_button]:min-h-[44px] max-md:[&_button]:min-w-[44px]">
                <SharedRowActions :actions="actionsOf(run)" :label="t('ai.history.actions.menu', { title: titleOf(run) })" />
              </div>
            </template>
          </li>
        </ul>
      </SharedPageState>
    </div>
  </section>
</template>
