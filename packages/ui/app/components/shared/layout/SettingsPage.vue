<script setup lang="ts">
/*
 * The settings page shell (DESIGN.md §6): one content container, the page's cards in the default slot, and the one save
 * bar that drives every value card on the page (`useSettingsSave`). The bar stays hidden until a card has unsaved edits.
 */
import { provideSettingsSave } from '../../../composables/useSettingsSave'

provideSettingsSave()
</script>

<template>
  <div class="liwan-settings-layout" data-testid="settings-layout">
    <SharedPageContainer class="liwan-settings-content">
      <slot />
      <SharedSettingsSaveBar />
    </SharedPageContainer>
  </div>
</template>
