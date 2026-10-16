// Nitro replaces this identifier with a literal from nuxt.config.ts. Never use
// runtimeConfig or an environment-variable build stamp: those are overrideable.
declare const __WEBVUE_BUILD_TENANCY_MODE__: string

export default defineNitroPlugin((nitroApp) => {
  const builtMode = __WEBVUE_BUILD_TENANCY_MODE__
  const assertMode = () => {
    const runtimeMode = process.env.WEBVUE_TENANCY_MODE ?? 'dedicated'
    if (!['dedicated', 'shared'].includes(builtMode) || runtimeMode !== builtMode) {
      throw new Error('tenancy_build_runtime_mismatch')
    }
  }
  // Nitro synchronously executes plugins while creating its app; throwing here
  // aborts the node-server entrypoint before listen(), including compiled proxies.
  assertMode()
  // Nitro catches request-hook errors and continues; a throwing hook is NOT a
  // rejection boundary. H3 awaits options.onRequest before its entire stack,
  // including Nitro routeRules (which run before ordinary server middleware).
  // Compatibility contract: reverify this ordering on H3/Nitro upgrades.
  const options = nitroApp.h3App.options
  const previous = options.onRequest
  options.onRequest = async function (...args) {
    assertMode()
    if (previous) await previous.apply(this, args)
  }
})
