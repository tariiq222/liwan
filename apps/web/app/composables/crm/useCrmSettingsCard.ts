import { computed, ref, watch, type Ref } from 'vue'
import type { CrmPreset, CrmSettings, CrmSettingsValues, CrmSettingsValuesPatch } from '@webvue/contracts'
import { ApiError } from '../useApi'
import { saveErrorMessage } from '../../utils/formFeedback'
import { useSaveCrmSettings } from './useCrmSettings'

/** What a card saves: some of the values, or a preset (which sets several values at once). */
export type CrmCardPatch = { values: CrmSettingsValuesPatch } | { preset: CrmPreset }

interface CardOptions<Draft> {
  settings: () => CrmSettings
  /** The fields this card owns, copied out of the settings values. */
  read: (values: CrmSettingsValues) => Draft
  /** The patch that saves exactly those fields. */
  toPatch: (draft: Draft) => CrmCardPatch
  /** Fetches the latest settings after a 409. */
  reload: () => Promise<CrmSettings>
}

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value))

/**
 * The draft of one settings card: it saves only its own fields with the latest shared revision, and on a 409
 * (a change made elsewhere) locks until the manager reloads, so a stale draft never overwrites newer settings.
 */
export function useCrmSettingsCard<Draft>(options: CardOptions<Draft>) {
  const { t } = useI18n()
  const { mutateAsync: saveSettings } = useSaveCrmSettings()
  const baseline = ref(options.settings())
  const draft = ref(copy(options.read(baseline.value.values))) as Ref<Draft>
  const failure = ref<unknown>(null)
  const saving = ref(false)
  const reloading = ref(false)
  const reloadFailed = ref(false)
  const dirty = computed(() => JSON.stringify(draft.value) !== JSON.stringify(options.read(baseline.value.values)))
  const conflict = computed(() => failure.value instanceof ApiError && failure.value.status === 409)
  const message = computed(() => {
    if (!failure.value) return ''
    return conflict.value ? t('crm.settings.conflict') : saveErrorMessage(failure.value, t('errors.generic'), t('errors.saveUncertain'))
  })
  const adopt = (settings: CrmSettings) => {
    baseline.value = settings
    draft.value = copy(options.read(settings.values))
  }
  // Another card's save refreshes the settings: a card with no edits follows, a card with edits keeps its own revision.
  watch(options.settings, (settings) => {
    if (!dirty.value && !reloading.value && !saving.value && !conflict.value) adopt(settings)
  })
  async function save() {
    if (saving.value || reloading.value || !dirty.value || conflict.value) return
    failure.value = null
    saving.value = true
    try {
      adopt(// The latest revision the page knows, not the one this draft started from: another card's save in this tab
      // must not make this card conflict. A change made elsewhere is not in the shared query, so it still answers 409.
      await saveSettings({ revision: options.settings().revision, ...options.toPatch(draft.value) }))
    } catch (error) {
      failure.value = error
    } finally {
      saving.value = false
    }
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
  const shell = computed(() => ({
    dirty: dirty.value, saving: saving.value, reloading: reloading.value, conflict: conflict.value, message: message.value, reloadFailed: reloadFailed.value,
  }))
  return { draft, shell, save, reload }
}
