<script setup lang="ts">
import ChatSettingsCard from '@/components/chat/ChatSettingsCard.vue'
import { useChatSettings } from '@/composables/useChatSettings'

// The chat application's settings, one page of cards under Settings > Applications. Reading and changing them
// needs `chat.settings.manage`; a holder of it sees every part.
const { t } = useI18n()
const { parts, shows } = useSettingsPage('chat')
const settings = useChatSettings(() => shows('messages'))
async function reloadSettings() {
  const result = await settings.refetch()
  if (result.isError) throw result.error
  if (!result.data) throw new Error(t('errors.generic'))
  return result.data
}
</script>

<template>
  <SharedSettingsPage width="form">
    <SharedPageHeader :title="t('nav.chat')" />
    <SharedForbiddenState v-if="!parts.length" :description="t('errors.forbidden')" />
    <template v-else>
      <section v-if="shows('messages')" id="messages" class="liwan-settings-anchor">
        <SharedPageState :loading="settings.isLoading.value" :error="settings.data.value ? null : settings.error.value" :empty="!settings.data.value" @retry="settings.refetch()">
          <ChatSettingsCard v-if="settings.data.value" :settings="settings.data.value" :reload-settings="reloadSettings" />
        </SharedPageState>
      </section>
    </template>
  </SharedSettingsPage>
</template>
