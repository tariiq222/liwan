<script setup lang="ts">
import { visibleShellModules } from '@/composables/nav/shellModules'
import { firstAllowedPath } from '@/utils/accessPolicy'

// `/settings` has no page of its own: it opens the first settings page this user may use (the
// same target as the rail's Settings entry), or their first allowed page when they have none.
const { me, ready } = useMe()
const identity = useWorkspaceIdentity()
await ready
const target = visibleShellModules(identity.value).find(module => module.id === 'settings')?.to ?? firstAllowedPath(me.value)
await navigateTo(target, { replace: true })
</script>

<template><SharedPageContainer><span class="sr-only" /></SharedPageContainer></template>
