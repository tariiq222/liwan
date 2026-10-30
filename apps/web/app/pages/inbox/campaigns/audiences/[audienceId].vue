<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import InboxAudienceForm from '@/components/inbox/campaigns/InboxAudienceForm.vue'
import InboxAudienceMembers from '@/components/inbox/campaigns/InboxAudienceMembers.vue'
import { useDeleteInboxAudience, useInboxAudience } from '@/composables/inbox/useInboxCampaigns'

// One audience: its definition, the live counts and the contacts that match it now. A delete is confirmed inline and is
// refused by the server while a campaign uses the audience.
const route = useRoute()
const { t } = useI18n()
const hydrated = useHydrated()
const toast = useToast()
const id = computed(() => {
  const value = Number(route.params.audienceId)
  return Number.isSafeInteger(value) && value > 0 ? value : null
})
const query = useInboxAudience(id)
const audience = query.data
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/inbox/campaigns/audiences', ['/inbox/campaigns/audiences']))
const { mutate: remove, isPending: removing } = useDeleteInboxAudience()
const confirming = ref(false)
const editVersion = ref(0)

function confirmDelete() {
  remove(id.value!, {
    onSuccess: () => navigateTo(backTo.value),
    onError: (e) => {
      confirming.value = false
      toast.add({ title: e instanceof Error ? e.message : t('errors.generic'), color: 'error' })
    },
  })
}
</script>

<template>
  <SharedRecordPage
    :title="audience?.name ?? t('inbox.campaigns.audiences.title')"
    :back-to="backTo"
    :back-label="t('inbox.campaigns.audiences.title')"
    :loading="id !== null && query.isPending.value"
    :error="id === null ? { status: 404 } : query.error.value"
    @retry="hydrated && query.refetch()"
  >
    <template v-if="audience" #actions>
      <UButton type="button" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="!hydrated || removing" :label="t('inbox.settings.delete')" data-testid="inbox-audience-delete" @click="confirming = true" />
    </template>
    <template v-if="audience && id">
      <SharedInlineConfirm
        v-if="confirming" :title="t('inbox.campaigns.audiences.deleteTitle', { name: audience.name })" :description="t('inbox.campaigns.audiences.deleteDescription')"
        :confirm-label="t('inbox.settings.delete')" :pending="removing" @confirm="confirmDelete" @cancel="confirming = false"
      />
      <SharedRecordSection variant="panel" :title="t('inbox.campaigns.audiences.definition')">
        <InboxAudienceForm :key="`${audience.id}-${editVersion}`" :audience="audience" :back-to="backTo" @saved="editVersion += 1" />
      </SharedRecordSection>
      <InboxAudienceMembers :audience-id="id" />
    </template>
  </SharedRecordPage>
</template>
