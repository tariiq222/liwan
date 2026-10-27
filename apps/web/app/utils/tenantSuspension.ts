// A tenant suspended while a tab is open: Odoo answers the first request with `tenant_suspended` and ends
// the session, so every later request only sees a generic session refusal. This latch keeps the reason for
// the tab, so the user lands on one clear suspended state instead of a bare login form and stray toasts.
// Browser only: a module-level latch on the server would be shared between users' requests, so there it
// never latches and never reads as latched.

import { watch, type Ref } from 'vue'

export const TENANT_SUSPENDED = 'tenant_suspended'

/** Where a suspended session goes: the login page, which explains the suspension. */
export const SUSPENDED_LOGIN = { path: '/login', query: { reason: TENANT_SUSPENDED } } as const

let suspended = false
let listener: (() => void) | undefined
const inBrowser = () => typeof window !== 'undefined'

export function isTenantSuspended(): boolean {
  return inBrowser() && suspended
}

/** Records the suspension; only the first report of a tab notifies the listener. */
export function reportTenantSuspension(): void {
  if (!inBrowser() || suspended) return
  suspended = true
  listener?.()
}

/** A new session (the user signed in again) starts without the latch. */
export function clearTenantSuspension(): void {
  suspended = false
}

export function onTenantSuspension(handler: () => void): void {
  listener = handler
}

/** Keeps a toast list empty while the tab is suspended: late refusals of earlier requests must not toast. */
export function dropToastsWhileSuspended(toasts: Ref<unknown[]>): void {
  watch(toasts, list => { if (list.length && isTenantSuspended()) toasts.value = [] })
}
