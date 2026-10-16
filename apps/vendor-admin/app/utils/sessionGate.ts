/**
 * Waits for the session load. A failed load (anything but a plain 401) reaches the error page,
 * except on a public page: sign-in and enrollment must still render and show their own
 * unavailable state.
 */
export async function settleSession(ready: Promise<void>, publicPage: boolean): Promise<void> {
  try {
    await ready
  } catch (error) {
    if (!publicPage) throw error
  }
}
