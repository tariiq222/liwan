import { setResponseHeader } from 'h3'
import { contentSecurityPolicy, createNonce, nonceScripts } from '../utils/content-security-policy'

// Sets the nonce-based document policy on every rendered page (see ../utils/content-security-policy.ts).
// Development is left alone: Vite's dev client injects its own scripts and evaluates modules.
export default defineNitroPlugin((nitroApp) => {
  if (import.meta.dev) return
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = createNonce()
    for (const part of ['head', 'bodyPrepend', 'body', 'bodyAppend'] as const) {
      html[part] = html[part].map(chunk => nonceScripts(chunk, nonce))
    }
    setResponseHeader(event, 'content-security-policy', contentSecurityPolicy(nonce))
  })
})
