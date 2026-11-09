<script setup lang="ts">
/*
 * The settings page shell (DESIGN.md §6): one content container, the page's cards in the default slot, and the one save
 * bar that drives every value card on the page (`useSettingsSave`). The bar stays hidden until a card has unsaved edits.
 * A long page (three or more `SharedSettingsSection`s) also shows a sticky in-page section navigation on the end side.
 */
import { provideSettingsSave } from '../../../composables/useSettingsSave'
import { provideSettingsNav } from '../../../composables/useSettingsNav'

provideSettingsSave()
const sections = provideSettingsNav()
const { t } = useI18n()
</script>

<template>
  <div class="liwan-settings-layout" data-testid="settings-layout">
    <SharedPageContainer class="liwan-settings-content">
      <div class="liwan-settings-body" :data-nav="sections.length >= 3 ? 'true' : undefined">
        <div class="liwan-settings-main grid min-w-0 gap-(--liwan-gap-section)"><slot /></div>
        <nav v-if="sections.length >= 3" class="liwan-settings-nav" :aria-label="t('app.sectionsNav')" data-testid="settings-section-nav">
          <ul>
            <li v-for="section in sections" :key="section.id"><a :href="`#${section.id}`">{{ section.title }}</a></li>
          </ul>
        </nav>
      </div>
      <SharedSettingsSaveBar />
    </SharedPageContainer>
  </div>
</template>
