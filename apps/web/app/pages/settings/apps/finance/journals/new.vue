<script setup lang="ts">
import { safeReturnTo } from '@liwan/ui/app/utils/safeReturnTo'
import JournalEditor from '@/components/finance/records/JournalEditor.vue'
import JournalsSection from '@/components/finance/records/JournalsSection.vue'

const LIST_PATH = '/settings/apps/finance/journals'
const { t } = useI18n()
const { can } = useAccess()
const route = useRoute()
const router = useRouter()
const canRead = computed(() => can('finance.journals.read'))
const canManage = computed(() => can('finance.journals.manage'))
const backTo = computed(() => safeReturnTo(route.query.returnTo, LIST_PATH, [LIST_PATH]))
</script>

<template>
  <SharedListPage :title="t('financeRecords.journals.title')" hide-header>
    <JournalsSection v-if="canRead" background />
  </SharedListPage>
  <SharedCreatePanel :title="t('financeRecords.journals.new')" :back-to="backTo">
    <JournalEditor v-if="canManage" @done="router.replace(backTo)" @cancel="router.push(backTo)" />
    <SharedForbiddenState v-else :description="t('financeRecords.forbidden')" />
  </SharedCreatePanel>
</template>
