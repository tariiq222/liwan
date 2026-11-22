<script setup lang="ts">
// The personal task list moved into «أعمالي» (owner decision 2026-11-21): one workspace with «بانتظاري» and «المهام»
// instead of two pages both called «مهامي». The record routes stay here (/my-tasks/{id}, /new, /{id}/edit) so saved
// links keep working; only the list itself moved, and this page forwards to it with that tab open, keeping the list's
// own query (?q=, ?scope=, ?view=) so a saved search still narrows the same list.
//
// The forward runs in setup, on the client, because it needs the current query; on the server the page renders the
// container below and the client takes over. `navigateTo` with `replace` keeps the redirect out of the back stack, so
// pressing back from the list does not bounce here again.
const route = useRoute()
if (import.meta.client) {
  const { view: _view, ...rest } = route.query
  await navigateTo({ path: '/work', query: { ...rest, view: 'tasks' }, hash: route.hash }, { replace: true })
}
</script>

<template>
  <SharedPageContainer>
    <SharedPageState :loading="true" />
  </SharedPageContainer>
</template>
