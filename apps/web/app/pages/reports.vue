<script setup lang="ts">
const route = useRoute()
await navigateTo({ path: '/projects/dashboard', query: route.query }, { redirectCode: 308 })
</script>
