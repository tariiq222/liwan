<script setup lang="ts">
withDefaults(defineProps<{
  sections?: { id: string; label: string }[]
  width?: 'list' | 'detail' | 'form'
}>(), { width: 'list' })
</script>

<template>
  <div class="nasq-settings-layout" data-testid="settings-layout">
    <SharedPageContainer :width="width" class="nasq-settings-content">
      <slot />
    </SharedPageContainer>
  </div>
</template>

<style>
/* Settings route navigation belongs to the shell. */
.nasq-settings-layout { display: block; min-width: 0; }
/* Geometry only: U components own surfaces and field styling. */
.nasq-settings-content { min-width: 0; width: 100%; container: settings / inline-size; }
.nasq-settings-content .nasq-form { max-width: none; margin-inline: 0; }
.nasq-settings-content .nasq-settings-anchor { scroll-margin-block-start: 88px; }
.nasq-settings-field { display: grid; min-width: 0; gap: .5rem; font-size: var(--text-sm); }
.nasq-settings-field > span { color: var(--ui-text-muted); }
.nasq-settings-search { grid-column: 1 / -1; }
.nasq-settings-pagination { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: .5rem; font-size: var(--text-xs); color: var(--ui-text-muted); }
.nasq-settings-options, .nasq-settings-cards, .nasq-settings-branding { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 1.5rem; }
.nasq-settings-option { display: flex; min-width: 0; align-items: start; gap: .75rem; border: 1px solid var(--ui-border); border-radius: var(--radius-xl); padding: 1.25rem; font-size: var(--text-sm); }
.nasq-settings-option:has([data-state="checked"], input:checked) { border-color: var(--ui-primary); }
.nasq-settings-option > span { min-width: 0; overflow-wrap: anywhere; }
@container settings (min-width: 640px) {
  .nasq-settings-options, .nasq-settings-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nasq-settings-branding { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
}
@container settings (max-width: 480px) {
  .nasq-settings-content .nasq-form-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
