<script setup lang="ts">
import { useTeamActions } from '@/composables/useTeamActions'

definePageMeta({ capability: 'vendor.accounts.manage' })
const { t } = useI18n()
const team = useTeamActions(() => refreshNuxtData('vendor:team'))
const { busy, errorKey, invitation } = team
/** The link is shown once and kept nowhere else: leaving the panel (Escape, the backdrop, a link) while it is shown asks first. */
async function leave() {
  team.dismissInvitation()
  await nextTick()
  await navigateTo('/team')
}
</script>

<template>
  <SharedCreatePanel :title="t('team.form.title')" back-to="/team">
    <SharedUnsavedChanges :dirty="!!invitation" />
    <TeamInvitationLink v-if="invitation" :key="invitation.link" v-bind="invitation" @dismiss="leave" />
    <TeamAccountForm v-else :busy="busy" :error-key="errorKey" @submit="team.invite" @cancel="navigateTo('/team')" />
  </SharedCreatePanel>
</template>
