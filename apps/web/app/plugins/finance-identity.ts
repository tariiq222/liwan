import { createFinanceIdentityGeneration } from '../composables/finance/useFinanceSetup'

// Owns the finance observed-identity generation for the lifetime of the Nuxt app, outside any component.
// Each server request has its own app and so starts at 0; the watcher stops when the render ends (server)
// or the app unmounts (client).
export default defineNuxtPlugin({
  name: 'finance-identity',
  setup(nuxtApp) {
    const { me } = useMe()
    const { generation, stop } = createFinanceIdentityGeneration(me)
    if (import.meta.server) nuxtApp.hooks.hookOnce('app:rendered', stop)
    else nuxtApp.vueApp.onUnmount(stop)
    return { provide: { financeIdentityGeneration: generation } }
  },
})
