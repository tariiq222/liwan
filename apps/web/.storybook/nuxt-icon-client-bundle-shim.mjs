// Nuxt's icon module generates "#build/nuxt-icon-client-bundle" at build time
// with any pre-bundled icons from icon.clientBundle; outside a real Nuxt build
// that template doesn't exist. Icons still load fine on demand through
// Iconify's normal fetch path, so a no-op init is enough for Storybook.
export function init() {}
