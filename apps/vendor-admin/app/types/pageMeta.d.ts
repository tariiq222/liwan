declare module '#app' {
  interface PageMeta {
    /** Reachable without a session (sign-in, enrollment). */
    public?: boolean
    /** The capability a signed-in account needs to open the page. */
    capability?: string
  }
}

export {}
