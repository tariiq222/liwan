<script setup lang="ts">
import InboxRuleForm from '@/components/inbox/InboxRuleForm.vue'
import InboxRulesSection from '@/components/inbox/InboxRulesSection.vue'
import InboxRuleTester from '@/components/inbox/InboxRuleTester.vue'

// Create a rule: the route-backed create panel over the rules list.
const { t } = useI18n()
const { can } = useAccess()
const backTo = '/settings/apps/inbox/rules'
</script>

<template>
  <SharedRecordPage :title="t('inbox.automation.rules.title')" hide-header>
    <div v-if="can('inbox.automation.manage')" class="flex flex-col gap-(--liwan-gap-card)">
      <InboxRulesSection />
      <InboxRuleTester />
    </div>
  </SharedRecordPage>
  <SharedCreatePanel :title="t('inbox.automation.rules.create')" :description="t('inbox.automation.rules.createHint')" :back-to="backTo">
    <InboxRuleForm v-if="can('inbox.automation.manage')" :back-to="backTo" @saved="navigateTo({ path: backTo }, { replace: true })" />
    <SharedForbiddenState v-else />
  </SharedCreatePanel>
</template>
