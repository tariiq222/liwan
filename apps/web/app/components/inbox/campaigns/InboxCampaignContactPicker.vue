<script setup lang="ts">
import { refDebounced } from '@vueuse/core'
import { useInboxAudienceMembers } from '@/composables/inbox/useInboxCampaigns'

// Picks one contact of an audience by name or number: the sample a preview is rendered for, and the recipient of a test
// send. The list is searched on the server, so a large audience is never loaded whole.
const model = defineModel<number | null>({ required: true })
const props = defineProps<{ audienceId: number | null; disabled?: boolean; placeholder: string; label: string }>()
const search = ref('')
const q = refDebounced(search, 250)
const members = useInboxAudienceMembers(() => props.audienceId, () => ({ consent: '' as const, q: q.value, offset: 0 }))
const items = computed(() => (members.data.value?.items ?? []).map(member => ({ id: member.id, label: member.phone ? `${member.name} · ${member.phone}` : member.name })))
</script>

<template>
  <USelectMenu
    :model-value="model ?? undefined"
    v-model:search-term="search"
    value-key="id"
    :items="items"
    ignore-filter
    class="w-full"
    :loading="members.isFetching.value"
    :disabled="props.disabled || !props.audienceId"
    :placeholder="props.placeholder"
    :aria-label="props.label"
    @update:model-value="model = ($event as number | undefined) ?? null"
  />
</template>
