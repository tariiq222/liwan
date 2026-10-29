<script setup lang="ts">
import { useInboxChannels } from '@/composables/inbox/useInboxSettings'

// The entry to each channel's automatic messages (welcome, away, satisfaction survey): a channel opens its own page.
const { t } = useI18n()
const { data, isLoading, error, refetch } = useInboxChannels()
const items = computed(() => data.value?.items ?? [])
</script>

<template>
  <SharedRecordSection id="auto-messages" variant="list" class="webvue-settings-anchor" :title="t('inbox.automation.messages.title')" :description="t('inbox.automation.messages.hint')">
    <SharedLoadingSkeleton v-if="isLoading" class="m-4" />
    <SharedPageState v-else-if="error" class="m-4" :error="error" @retry="refetch()" />
    <p v-else-if="!items.length" class="px-(--webvue-card-pad) py-4 text-sm text-muted">{{ t('inbox.settings.channels.empty') }}</p>
    <NuxtLink
      v-for="channel in items"
      v-else
      :key="channel.id"
      :to="`/settings/apps/inbox/auto-messages/${channel.id}`"
      class="flex items-center justify-between gap-3 px-(--webvue-card-pad) py-3 text-start transition-colors duration-150 hover:bg-(--webvue-row-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none"
      :data-testid="`inbox-auto-messages-${channel.id}`"
    >
      <span class="flex min-w-0 items-center gap-3">
        <span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><UIcon name="i-lucide-bot-message-square" class="size-5" aria-hidden="true" /></span>
        <span class="truncate text-sm font-medium text-highlighted">{{ channel.name }}</span>
      </span>
      <UIcon name="i-lucide-chevron-right" class="size-4 text-muted rtl:rotate-180" aria-hidden="true" />
    </NuxtLink>
  </SharedRecordSection>
</template>
