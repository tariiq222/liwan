import { safeReturnTo } from '@webvue/ui/app/utils/safeReturnTo'
import { statusTag, type PageHeaderTag } from '@webvue/ui/app/utils/pageHeaderTag'
import { ApiError } from '@/composables/useApi'
import {
  useDeleteJournalEntry,
  useFinanceEntry,
  useFinanceEntryTransition,
  type FinanceEntryTransition,
} from '@/composables/finance/useFinanceEntries'
import { financeErrorMessage } from '../financeErrors'
import { offeredMenuItems, readFinanceActions } from '../financeActions'
import { entryErrorKey } from './entryErrors'
import { ENTRIES_PATH, entryTitle } from './entryPaths'
import { ENTRY_STATE_TONE } from './entryTones'

export type EntryConfirmation = 'post' | 'reset' | 'unreconcile' | 'delete'

const TRANSITION_OF = { post: 'post', reset: 'reset-to-draft', unreconcile: 'unreconcile' } as const satisfies Record<Exclude<EntryConfirmation, 'delete'>, FinanceEntryTransition>
const CONFIRM_COLOR = { post: 'primary', reset: 'warning', unreconcile: 'warning', delete: 'error' } as const satisfies Record<EntryConfirmation, string>

/**
 * The state of one entry's record page: the loaded record, the heading props of SharedRecordPage (state and journal
 * tags, back link), the actions its state and the caller's capabilities allow, and the one confirmation open at a
 * time. The page owns the SharedRecordPage shell; EntryRecordActions, EntryRecordBody and EntryRecordAside draw its
 * slots from this. Every change waits for the server's answer; a refusal is shown inline in the caller's language.
 */
export function useEntryRecord() {
  const route = useRoute()
  const { t } = useI18n()
  const hydrated = useHydrated()

  const id = computed(() => Number(route.params.id))
  const validId = computed(() => Number.isSafeInteger(id.value) && id.value > 0)
  const query = useFinanceEntry(computed(() => validId.value ? id.value : null))
  const entry = computed(() => query.data.value)
  const backTo = computed(() => safeReturnTo(route.query.returnTo, ENTRIES_PATH, [ENTRIES_PATH]))
  const actions = computed(() => entry.value ? readFinanceActions(entry.value) : null)
  const title = computed(() => entry.value ? entryTitle(entry.value, t('financeAccounting.draftNumber')) : t('financeAccounting.entries.record'))
  const error = computed(() => query.error.value ?? (validId.value ? null : new ApiError(404, 'not_found', t('errors.generic'))))

  const tags = computed<PageHeaderTag[]>(() => {
    const record = entry.value
    if (!record) return []
    return [
      statusTag({ tone: ENTRY_STATE_TONE[record.state], label: t(`financeAccounting.states.${record.state}`) }, 'finance-entry-state'),
      { label: record.journal.name, kind: 'category', icon: 'i-lucide-book-open', testId: 'finance-entry-journal' },
    ]
  })

  const confirming = ref<EntryConfirmation | null>(null)
  const editing = ref(false)
  // A draft posted elsewhere while it is open here leaves edit mode, so the posted entry's actions come back.
  watch(() => actions.value?.can('edit'), canEdit => { if (!canEdit) editing.value = false })
  const actionError = ref('')
  const transition = useFinanceEntryTransition()
  const removal = useDeleteJournalEntry()
  const busy = computed(() => transition.isPending.value || removal.isPending.value)

  async function attempt(work: () => Promise<unknown>) {
    if (!hydrated.value || busy.value) return false
    actionError.value = ''
    try {
      await work()
      confirming.value = null
      return true
    } catch (cause) {
      actionError.value = financeErrorMessage(cause, entryErrorKey, t)
      return false
    }
  }
  async function applyConfirmation() {
    const kind = confirming.value
    if (!kind) return
    if (kind !== 'delete') {
      await attempt(() => transition.mutateAsync({ id: id.value, action: TRANSITION_OF[kind] }))
    } else if (await attempt(() => removal.mutateAsync(id.value))) {
      await navigateTo(backTo.value, { replace: true })
    }
  }

  function ask(kind: EntryConfirmation) { confirming.value = kind }
  function edit() {
    confirming.value = null
    actionError.value = ''
    editing.value = true
  }
  const menu = computed(() => {
    const set = actions.value
    if (!set) return []
    return offeredMenuItems(set, [
      ['reset_to_draft', { label: t('financeAccounting.actions.resetToDraft'), icon: 'i-lucide-undo-2', onSelect: () => ask('reset') }],
      ['unreconcile', { label: t('financeAccounting.actions.unreconcile'), icon: 'i-lucide-unlink', onSelect: () => ask('unreconcile') }],
      ['delete', { label: t('financeAccounting.actions.delete'), icon: 'i-lucide-trash-2', destructive: true, onSelect: () => ask('delete') }],
    ])
  })

  // The text and look of the open confirmation, so the page draws one SharedInlineConfirm for all four actions.
  const confirmation = computed(() => {
    const kind = confirming.value
    if (!kind) return null
    return {
      title: t(`financeAccounting.confirm.${kind}`, { name: title.value }),
      description: t(`financeAccounting.confirm.${kind}Hint`),
      confirmLabel: t(`financeAccounting.actions.${kind === 'reset' ? 'resetToDraft' : kind}`),
      color: CONFIRM_COLOR[kind],
    }
  })

  return reactive({
    // SharedRecordPage heading props: `v-bind="record.header"`.
    header: reactive({
      keepContent: computed(() => !!entry.value),
      title,
      tags,
      backTo,
      loading: query.isLoading,
      error,
    }),
    retry: () => { void query.refetch() },
    entry,
    actions,
    menu,
    title,
    busy,
    hydrated,
    confirming,
    confirmation,
    editing,
    edit,
    backTo,
    actionError,
    ask,
    applyConfirmation,
  })
}

export type EntryRecordState = ReturnType<typeof useEntryRecord>
