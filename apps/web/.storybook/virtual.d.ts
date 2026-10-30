declare module 'virtual:liwan-i18n' {
  export const locales: { code: string; language: string; dir: 'rtl' | 'ltr' }[]
  const messages: Record<string, Record<string, unknown>>
  export default messages
}

declare module 'virtual:liwan-nuxt-ui-components' {
  import type { Component } from 'vue'
  const components: Record<string, Component>
  export default components
}
