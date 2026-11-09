<script setup lang="ts">
/*
 * The one save bar of a settings page (DESIGN.md §6): it sits at the bottom of the content and appears only while a card
 * on the page has unsaved edits or a save is running. It counts the edited cards, says so when one of them failed, and
 * saves every edited card at once or reverts them all through the page registry (`useSettingsSave`). Cards keep their own
 * errors and a conflicted card stays locked, so the bar never bypasses a card's state. With nothing registered the bar
 * renders nothing.
 */
import { useSettingsSaveRegistry } from '../../../composables/useSettingsSave'

const registry = useSettingsSaveRegistry()
const { t } = useI18n()
const hydrated = useHydrated()
const pending = computed(() => registry?.pending.value ?? 0)
const saving = computed(() => registry?.saving.value ?? false)
const failed = computed(() => registry?.failed.value ?? false)
const shown = computed(() => pending.value > 0 || saving.value)
const busy = computed(() => !hydrated.value || saving.value)
</script>

<template>
  <div
    v-if="shown"
    class="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-surface bg-inverted px-4 py-2 text-inverted shadow-lg"
    role="region"
    :aria-label="t('app.saveBar')"
    data-testid="settings-save-bar"
  >
    <p class="text-sm" aria-live="polite">{{ failed ? t('app.saveSomeFailed') : t('app.unsavedCount', { n: pending }) }}</p>
    <div class="flex items-center gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        class="text-inverted ring ring-inset ring-current/40 hover:bg-transparent hover:text-inverted hover:ring-current"
        :label="t('app.revert')"
        :disabled="busy"
        data-testid="settings-save-bar-revert"
        @click="registry?.revertAll()"
      />
      <UButton
        type="button"
        :label="t('app.saveChanges')"
        :loading="saving"
        :disabled="busy"
        data-testid="settings-save-bar-save"
        @click="registry?.saveAll()"
      />
    </div>
  </div>
</template>
