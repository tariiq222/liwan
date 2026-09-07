<script setup lang="ts">
defineProps<{ sections?: { id: string; label: string }[] }>()
</script>

<template>
  <div class="nasq-settings-layout" data-testid="settings-layout">
    <div class="nasq-settings-content">
      <slot />
    </div>
  </div>
</template>

<style>
/* Settings route navigation belongs to the shell. */
.nasq-settings-layout { display: block; min-width: 0; }
/* Settings share one responsive anatomy; widths follow the content column. */
.nasq-settings-content { min-width: 0; width: 100%; container: settings / inline-size; }
.nasq-settings-content .nasq-page-stack { margin: 0; width: 100%; max-width: none; }
.nasq-settings-content .nasq-form { max-width: none; margin-inline: 0; }
.nasq-settings-content .nasq-settings-form-page { max-width: 940px; }
.nasq-settings-content .nasq-page-width-form { max-width: 940px; }
.nasq-settings-content .nasq-form-section,
.nasq-settings-content .nasq-settings-anchor { scroll-margin-block-start: 88px; }
.nasq-settings-content .nasq-form-section,
.nasq-settings-content .nasq-form-section:last-of-type { border-block-end: 1px solid var(--border); }
.nasq-settings-content .nasq-panel-body > :last-child,
.nasq-settings-content .nasq-panel-body > :last-child .nasq-form-section:last-child { border-block-end: 0; }
.nasq-settings-content .nasq-panel .nasq-panel { border: 0; border-radius: 0; background: transparent; }
.nasq-settings-content .nasq-panel .nasq-settings-filters { border: 0; border-radius: 0; background: transparent; border-block-end: 1px solid var(--border); }
.nasq-settings-content .nasq-panel .nasq-settings-pagination { padding: 12px 16px; }
.nasq-settings-filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr)); align-items: end; gap: 12px; padding: 16px; border: 1px solid var(--border); border-radius: 8px; background: var(--card); }
.nasq-settings-field { display: grid; min-width: 0; gap: 8px; font-size: .929rem; }
.nasq-settings-field > span { color: var(--muted-foreground); font-size: .857rem; }
.nasq-settings-search { grid-column: 1 / -1; }
.nasq-settings-filter-actions { display: flex; grid-column: 1 / -1; justify-content: flex-end; border-block-start: 1px solid var(--border); padding-block-start: 12px; }
.nasq-settings-content select { width: 100%; min-width: 0; height: 40px; border: 1px solid var(--input); border-radius: 8px; background: var(--background); padding-inline: 12px; font-size: .929rem; }
.nasq-settings-content select:disabled { opacity: .5; }
.nasq-settings-content input[type="date"] { min-width: 0; width: 100%; }
.nasq-settings-table { width: 100%; min-width: 680px; font-size: .929rem; }
.nasq-settings-table th { padding: 12px 16px; color: var(--muted-foreground); font-size: .857rem; font-weight: 500; white-space: nowrap; }
.nasq-settings-table td { padding: 14px 16px; vertical-align: middle; }
.nasq-settings-table td:last-child { white-space: nowrap; }
.nasq-settings-pagination { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .857rem; color: var(--muted-foreground); }
.nasq-settings-options { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
.nasq-settings-option { display: flex; min-width: 0; align-items: start; gap: 10px; border: 1px solid var(--border); border-radius: 8px; padding: 14px; font-size: .929rem; }
.nasq-settings-option:has(input:checked) { border-color: var(--brand-border); background: var(--brand-soft); }
.nasq-settings-option input { margin-block-start: 4px; flex: none; accent-color: var(--primary); }
.nasq-settings-option > span { min-width: 0; overflow-wrap: anywhere; }
.nasq-settings-cards { display: grid; grid-template-columns: minmax(0, 1fr); align-items: start; gap: 16px; }
.nasq-settings-branding { display: grid; grid-template-columns: minmax(0, 1fr); gap: 20px; }
.nasq-settings-section-heading { margin-block-end: 16px; font-size: 1rem; font-weight: 600; }
@container settings (min-width: 640px) {
  .nasq-settings-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .nasq-settings-options, .nasq-settings-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nasq-settings-branding { grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); }
}
@container settings (max-width: 480px) {
  .nasq-settings-content .nasq-form-grid { grid-template-columns: minmax(0, 1fr); }
  .nasq-settings-content .nasq-panel-body { padding: 16px; }
}
</style>
