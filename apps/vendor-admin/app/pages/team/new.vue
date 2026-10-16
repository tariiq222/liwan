<script setup lang="ts">
import { useTeamActions } from '@/composables/useTeamActions'

definePageMeta({ capability: 'vendor.accounts.manage' })
const { t } = useI18n()
const team = useTeamActions(() => refreshNuxtData('vendor:team'))
const { busy, errorKey, invitation } = team
</script>

<template>
  <SharedCreatePanel :title="t('team.form.title')" back-to="/team">
    <TeamInvitationLink v-if="invitation" :key="invitation.link" v-bind="invitation" @dismiss="navigateTo('/team')" />
    <TeamAccountForm v-else :busy="busy" :error-key="errorKey" @submit="team.invite" @cancel="navigateTo('/team')" />
  </SharedCreatePanel>
</template>
