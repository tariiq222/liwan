import { computed, inject, provide, reactive, ref, type ComputedRef, type InjectionKey } from 'vue'

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
  /**
   * Runs the card's save and resolves once it has settled. When the save failed and `focus` is not false, the card moves
   * focus to its first invalid control; the answer says whether it did, so the bar focuses only the first failing card.
   */
  submit: (options?: { focus?: boolean }) => Promise<boolean | void>
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
  /** Saves every dirty card that is neither locked by a conflict nor already saving, one after another. */
  saveAll: () => Promise<void>
  /** Reverts every dirty card. */
  revertAll: () => void
}

/**
 * Moves focus to the first control marked `aria-invalid="true"` inside `root` (a failed save's field error), and answers
 * whether it found one. `UFormField` links the control to its error text through `aria-describedby`, and that error
 * element has no live-region role of its own, so focusing the control is what announces the error: nothing else
 * announces it, and nothing announces it twice. The scroll centres the control so it is not left under the sticky save
 * bar; it is instant, never smooth, so it respects reduced motion.
 */
export function focusFirstInvalidControl(root: ParentNode | null | undefined): boolean {
  const control = root?.querySelector<HTMLElement>('[aria-invalid="true"]')
  if (!control) return false
  control.focus({ preventScroll: true })
  control.scrollIntoView({ block: 'center' })
  return true
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
  const running = ref(false)
  const registry: SettingsSaveRegistry = {
    pending: computed(() => values().filter(entry => entry.dirty).length),
    saving: computed(() => running.value || values().some(entry => entry.saving)),
    failed: computed(() => values().some(entry => entry.failed)),
    register(entry) {
      entries.set(entry.id, entry)
      return () => { if (entries.get(entry.id) === entry) entries.delete(entry.id) }
    },
    // Cards of one settings object share a revision: saving them together would send the same revision twice and the
    // second would answer 409. So the bar saves them in turn, each card reading the revision the previous save stored.
    // A conflicted card is locked until its current values are reloaded, and a card already saving is left alone.
    // Focus goes to the first invalid control of the first card (in page order) that has one, and to no other card.
    async saveAll() {
      if (running.value) return
      running.value = true
      try {
        let focused = false
        for (const entry of values()) {
          if (!entry.dirty || entry.conflict || entry.saving) continue
          if (await entry.submit({ focus: !focused })) focused = true
        }
      } finally {
        running.value = false
      }
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
