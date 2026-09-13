// @nuxt/ui's own "#imports" stub (dist/runtime/vue/stubs/vue-router.js) covers
// what @nuxt/ui's own components need in a plain Vue app, but @nuxt/icon's
// runtime components (pulled in by every component that renders an <Icon>)
// import a few more names from "#imports" that only exist inside a real Nuxt
// build. Re-export the real stub and add the missing few so every top-level
// Nuxt UI component can be registered globally in Storybook, not only the
// ones that happen to skip icons.
export * from '@nuxt/ui/runtime/vue/stubs/vue-router.js'
export { defineComponent, onServerPrefetch } from 'vue'

export function onNuxtReady(callback) {
  callback()
}

export async function useAsyncData(_key, handler) {
  try {
    const data = await handler()
    return { data: { value: data } }
  } catch {
    return { data: { value: null } }
  }
}
