// Nuxt's icon module generates "#build/nuxt-icon-client-bundle" at build time
// from icon.clientBundle scanning; outside a real Nuxt build that template
// doesn't exist. @nuxt/icon's runtime calls this init() before ever checking
// its in-memory icon store (see loadIcon in dist/runtime/components/shared.js:
// "initClientBundle(_addIcon); const _icon = _getIcon(name); if (_icon) return
// _icon"), and only reaches for the network when the store still misses.
// Registering the whole installed @iconify-json/lucide collection up front
// through @iconify/vue's own addCollection (the same store api.iconify.design
// would otherwise be asked to fill) means every "lucide:*" lookup already
// hits, so no request ever leaves the browser — matching the app's own
// icon: { provider: 'none', fallbackToApi: false } in nuxt.config.ts, without
// touching that file.
import { addCollection } from '@iconify/vue'
import lucide from '@iconify-json/lucide/icons.json'

let initialized = false

export function init() {
  if (initialized) return
  addCollection(lucide)
  initialized = true
}
