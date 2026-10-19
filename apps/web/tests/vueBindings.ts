import * as Vue from 'vue'

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Vue's runtime exports as `new Function` parameter bindings for tests that evaluate a compiled SFC.
 *
 * Only identifier names: some Node/Vitest pairs add CommonJS interop keys such as `module.exports`
 * to the namespace object, and a parameter with that name makes `new Function` throw
 * "Arg string terminates parameters early".
 */
export const vueBindings: Record<string, unknown> = Object.fromEntries(
  Object.entries(Vue).filter(([key]) => IDENTIFIER.test(key)),
)
