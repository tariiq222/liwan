<script setup lang="ts">
import SettingsPreviewRow from '@/components/settings/SettingsPreviewRow.vue'
import type { SettingsPreviewItem } from '@/utils/settingsPreview'

// The body of a preview card: its rows with the shared loading, error and empty states.
defineProps<{ items: SettingsPreviewItem[]; loading?: boolean; error?: unknown; emptyText: string }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <SharedPageState :loading="loading" :error="error" :empty="items.length === 0" :empty-text="emptyText" @retry="$emit('retry')">
    <ul class="divide-y divide-default" data-testid="settings-preview-list">
      <li v-for="item in items" :key="item.id" class="min-w-0"><SettingsPreviewRow :item="item" /></li>
    </ul>
  </SharedPageState>
</template>
