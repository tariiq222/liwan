import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineNuxtConfig({
  extends: ['@nasq/ui'],
  // Same naming as the ui layer: the group folder is dropped (shared/data/InvoiceLines.vue is SharedInvoiceLines),
  // and shared/commerce/PriceBreakdown.vue is SharedCommercePriceBreakdown.
  components: [
    { path: join(here, 'app/components/shared/commerce'), prefix: 'SharedCommerce', pathPrefix: false, ignore: ['**/__tests__/**'] },
    { path: join(here, 'app/components/shared/data'), prefix: 'Shared', pathPrefix: false, ignore: ['**/__tests__/**'] },
  ],
  // Only the layer's own messages: @nuxtjs/i18n merges these files into the app's locales
  // (names, direction and the default locale belong to the app).
  i18n: {
    locales: ['ar', 'en'].map(code => ({ code, files: [`${code}/commercial.json`] })),
  },
})
