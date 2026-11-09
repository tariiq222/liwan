declare module 'vue-router' {
  interface RouteMeta {
    /** Navigation within the same non-empty group keeps the current page entrance. */
    pageEntranceGroup?: (path: string) => string | undefined
  }
}

export {}
