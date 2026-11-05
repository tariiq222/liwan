import { computed, inject, provide, reactive, type ComputedRef, type InjectionKey } from 'vue'

/** One settings card's live state as its page's save bar sees it. */
export interface SettingsSaveEntry {
  /** The card's `id`, the anchor of its settings section. */
  id: string
  /** The card holds edits the user has not saved yet. */
  dirty: boolean
  saving: boolean
  conflict: boolean
  /** The card shows a save failure message. */
  failed: boolean
  /** Submits the card's own form, so its validation and focus handling still run. */
  submit: () => void
  revert: () => void
}

/** The one save bar of a settings page: what it shows and its two bulk actions. */
export interface SettingsSaveRegistry {
  /** Number of cards with unsaved edits. */
  pending: ComputedRef<number>
  /** Any card is saving. */
  saving: ComputedRef<boolean>
  /** Any card shows a save error. */
  failed: ComputedRef<boolean>
  /** Adds a card to the page bar; the returned function removes it again. */
  register: (entry: SettingsSaveEntry) => () => void
  /** Submits every dirty card that is neither locked by a conflict nor already saving. */
  saveAll: () => void
  /** Reverts every dirty card. */
  revertAll: () => void
}

const SETTINGS_SAVE: InjectionKey<SettingsSaveRegistry> = Symbol('settings-save')

/**
 * Called once by SharedSettingsPage. Every SharedSettingsCard under it registers here instead of drawing its own
 * footer, and SharedSettingsSaveBar drives them all from one place. With no card registered the page bar stays hidden
 * and the bulk actions do nothing.
 */
export function provideSettingsSave(): SettingsSaveRegistry {
  const entries = reactive(new Map<string, SettingsSaveEntry>())
  const values = () => Array.from(entries.values())
  const registry: SettingsSaveRegistry = {
    pending: computed(() => values().filter(entry => entry.dirty).length),
    saving: computed(() => values().some(entry => entry.saving)),
    failed: computed(() => values().some(entry => entry.failed)),
    register(entry) {
      entries.set(entry.id, entry)
      return () => { if (entries.get(entry.id) === entry) entries.delete(entry.id) }
    },
    // A conflicted card is locked until its current values are reloaded, and a card already saving must not submit
    // twice, so the bar leaves both out.
    saveAll() {
      for (const entry of values()) if (entry.dirty && !entry.conflict && !entry.saving) entry.submit()
    },
    revertAll() {
      for (const entry of values()) if (entry.dirty) entry.revert()
    },
  }
  provide(SETTINGS_SAVE, registry)
  return registry
}

/** The page's registry, or null outside a settings page: such a card keeps its own save footer. */
export function useSettingsSaveRegistry(): SettingsSaveRegistry | null {
  return inject(SETTINGS_SAVE, null)
}
