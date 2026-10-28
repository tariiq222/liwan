declare module '#app' {
  interface PageMeta {
    /**
     * Who may open the page without the signed-in shell. `public`: anyone, no session needed
     * (invitation acceptance, the pay page). `guest`: only a signed-out visitor (login).
     * Omitted: a signed-in user who can reach the path.
     */
    access?: 'public' | 'guest'
  }
}

export {}
