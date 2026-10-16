import type { RouteLocationNormalized } from 'vue-router'

declare module '#app' {
  interface RuntimeNuxtHooks {
    /** Observe the actual client route before auth awaits; listeners only pause local writers. */
    'webvue:navigation:start': (to: RouteLocationNormalized) => void
  }
}

export {}
