<script setup lang="ts">
/*
 * The one save bar of a settings page (DESIGN.md §6): it sits at the bottom of the content and appears only while a card
 * on the page has unsaved edits or a save is running. It counts the edited cards, says so when one of them failed, and
 * saves every edited card at once or reverts them all through the page registry (`useSettingsSave`). Cards keep their own
 * errors and a conflicted card stays locked, so the bar never bypasses a card's state. With nothing registered the bar
 * renders nothing. The announcement is a separate polite live region that stays mounted (a region created together with
 * its text is usually not announced); the visible sentence is not a live region, so nothing is read twice. Both buttons
 * draw their own focus ring: the bar is `bg-inverted`, where the stock `outline-inverted/25` is the bar's own colour.
 * `outline-default` is `--ui-border`, a light line (#e2e6ec, 14:1 on the dark bar #1c1917) in light mode and a dark one
 * (#393e49, 10.7:1 on the white bar) in dark mode.
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
const summary = computed(() => failed.value ? t('app.saveSomeFailed') : t('app.unsavedCount', { n: pending.value }))
// The always-mounted live region reads the summary when the bar appears or its count changes, and is emptied when the bar goes.
const announcement = computed(() => shown.value ? summary.value : '')
</script>

<template>
  <p class="sr-only" aria-live="polite" aria-atomic="true" data-testid="settings-save-bar-announcement">{{ announcement }}</p>
  <div
    v-if="shown"
    class="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-surface bg-inverted px-4 py-2 text-inverted shadow-lg"
    role="region"
    :aria-label="t('app.saveBar')"
    data-testid="settings-save-bar"
    data-slot="settings-save-bar"
  >
    <p class="text-sm">{{ summary }}</p>
    <div class="flex items-center gap-2">
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        class="text-inverted ring ring-inset ring-current/40 hover:bg-transparent hover:text-inverted hover:ring-current focus-visible:outline-default focus-visible:outline-2 focus-visible:outline-offset-2"
        :label="t('app.revert')"
        :disabled="busy"
        data-testid="settings-save-bar-revert"
        @click="registry?.revertAll()"
      />
      <UButton
        type="button"
        color="neutral"
        variant="solid"
        class="bg-default text-highlighted hover:bg-elevated disabled:bg-default aria-disabled:bg-default disabled:opacity-60 focus-visible:outline-default focus-visible:outline-2 focus-visible:outline-offset-2"
        :label="t('app.saveChanges')"
        :loading="saving"
        :disabled="busy"
        data-testid="settings-save-bar-save"
        @click="registry?.saveAll()"
      />
    </div>
  </div>
</template>
