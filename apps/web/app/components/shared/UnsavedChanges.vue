<script setup lang="ts">
import { onBeforeRouteLeave } from 'vue-router'
const props = defineProps<{ dirty: boolean }>()
const pendingPath = ref<string | null>(null)
let leaving = false
onBeforeRouteLeave(to => {
  if (!props.dirty || leaving) return true
  pendingPath.value = to.fullPath
  return false
})
async function discard() {
  if (!pendingPath.value) return
  leaving = true
  await navigateTo(pendingPath.value)
}
</script>
<template>
  <div v-if="pendingPath" role="alert" class="my-4 rounded-lg border border-amber-400/50 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
    <p>{{ $t('app.unsavedChanges') }}</p>
    <div class="mt-3 flex flex-wrap gap-2"><Button type="button" variant="outline" @click="pendingPath = null">{{ $t('app.stay') }}</Button><Button type="button" variant="destructive" @click="discard">{{ $t('app.discardAndLeave') }}</Button></div>
  </div>
</template>
