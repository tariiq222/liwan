<script setup lang="ts">
import InboxRulesSection from '@/components/inbox/InboxRulesSection.vue'
import InboxRuleTester from '@/components/inbox/InboxRuleTester.vue'

// The automation rules and the "try it" box. Creating a rule is the route-backed panel at /rules/new over this page.
const { t } = useI18n()
const { can } = useAccess()
</script>

<template>
  <SharedRecordPage :title="t('inbox.automation.rules.title')" back-to="/settings/apps/inbox" :back-label="t('inbox.title')">
    <div v-if="can('inbox.automation.manage')" class="flex flex-col gap-(--liwan-gap-card)">
      <InboxRulesSection />
      <InboxRuleTester />
    </div>
    <SharedForbiddenState v-else />
  </SharedRecordPage>
</template>
