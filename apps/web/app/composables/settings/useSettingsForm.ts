import { computed, ref, watch, type Ref } from 'vue'
import { ApiError } from '../useApi'
import { saveErrorMessage } from '../../utils/formFeedback'

interface SettingsFormOptions<Source, Draft> {
  /** The current settings as the page's query holds them. */
  source: () => Source
  /** The fields this card owns, copied out of the settings. */
  read: (source: Source) => Draft
  /** Saves the draft; `latest` is the newest settings the page knows (for its revision). Answers the saved settings. */
  save: (draft: Draft, latest: Source) => Promise<Source>
  /** Fetches the current settings after a 409. */
  reload: () => Promise<Source>
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * The draft of one settings card (SharedSettingsCard): it saves only its own fields, reverts to the saved values, and
 * on a 409 (a change made elsewhere) locks until the manager reloads, so a stale draft never overwrites newer settings.
 * `state` binds straight onto the card.
 */
export function useSettingsForm<Source, Draft>(options: SettingsFormOptions<Source, Draft>) {
  const { t } = useI18n()
  const baseline = ref(options.source()) as Ref<Source>
  const draft = ref(copy(options.read(baseline.value))) as Ref<Draft>
  const failure = ref<unknown>(null)
  const saving = ref(false)
  const reloading = ref(false)
  const reloadFailed = ref(false)
  const dirty = computed(() => !same(draft.value, options.read(baseline.value)))
  const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
  const message = computed(() => {
    if (!failure.value) return ''
    return conflict.value ? t('app.settingsConflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
  })
  const adopt = (source: Source) => {
    baseline.value = source
    draft.value = copy(options.read(source))
  }
  // Another card's save, or a refetch, refreshes the settings. A card with no edits follows. A card with edits follows
  // only the new baseline when the fields it owns are unchanged; when they changed it locks like a 409, so its stale
  // draft cannot overwrite them.
  watch(options.source, (source) => {
    if (reloading.value || saving.value || conflict.value) return
    if (!dirty.value) adopt(source)
    else if (same(options.read(source), options.read(baseline.value))) baseline.value = source
    else failure.value = new ApiError(409, 'conflict', 'Settings changed; reload before saving')
  })
  async function save() {
    if (saving.value || reloading.value || !dirty.value || conflict.value) return
    failure.value = null
    saving.value = true
    try {
      // The latest settings the page knows, not the ones this draft started from: another card's save in this tab must
      // not make this card conflict. A change made elsewhere is not in the shared query, so it still answers 409.
      adopt(await options.save(draft.value, options.source()))
    } catch (error) {
      failure.value = error
    } finally {
      saving.value = false
    }
  }
  function revert() {
    if (saving.value || reloading.value) return
    draft.value = copy(options.read(baseline.value))
    if (!conflict.value) failure.value = null
  }
  async function reload() {
    if (reloading.value || saving.value) return
    reloading.value = true
    reloadFailed.value = false
    try {
      adopt(await options.reload())
      failure.value = null
    } catch {
      reloadFailed.value = true
    } finally {
      reloading.value = false
    }
  }
  const state = computed(() => ({
    dirty: dirty.value, saving: saving.value, reloading: reloading.value, conflict: conflict.value, message: message.value, reloadFailed: reloadFailed.value,
  }))
  return { draft, state, save, revert, reload }
}
