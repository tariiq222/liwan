# Phase 3 — `apps/vendor-admin` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Nasq vendor administration as its own Nuxt app (`apps/vendor-admin`, domain `admin.nasq.sa`) with its own passkey sign-in, session cookie, shell and the moved vendor pages, talking only to the control plane through a BFF; remove every vendor code path from `apps/web`.

**Architecture:** `apps/vendor-admin` extends two Nuxt layers: `@nasq/ui` (phase 1: identity, presentational components, `ShellFrame`/`ModuleRail`) and a new `@nasq/commercial-ui` (shared billing presentation used by both this app and the customer `/subscription` pages). Its Nitro server is a BFF: it signs every control-plane request with the service key, holds the session in one HttpOnly cookie, forwards `x-nasq-session`, and never talks to Odoo. The control plane (phase 2) is the only authority: it resolves the actor from the session on every request.

**Tech Stack:** Nuxt 4, `@nuxt/ui` v4, `@nuxtjs/i18n`, Nitro server routes, `@simplewebauthn/browser@14.0.0`, `@nasq/commercial-contracts` (signing), Vitest, Playwright with a virtual WebAuthn authenticator, Python policy tools.

**Spec:** [`docs/superpowers/specs/2026-10-15-nasq-vendor-admin-separation-design.md`](../specs/2026-10-15-nasq-vendor-admin-separation-design.md) · master plan [`2026-10-15-vendor-admin-separation-master.md`](2026-10-15-vendor-admin-separation-master.md) (section "Contract phase 2 hands to phase 3") · phase 1 [`2026-10-15-vendor-admin-p1-ui-layer.md`](2026-10-15-vendor-admin-p1-ui-layer.md) · phase 2 [`2026-10-15-vendor-admin-p2-identity.md`](2026-10-15-vendor-admin-p2-identity.md).

## Decisions recorded while planning (2026-10-16; the spec gets an addendum in Task 1)

- **D1 — shared billing presentation moves to `packages/commercial-ui`.** The customer `/subscription` pages use `SharedCommercePriceBreakdown`, `SharedInvoiceLines` and helpers (`cadenceLabel`, `formatVendorMoney`, `quoteLinesByTiming`, `invoiceStatusBadge`, `entitledFeaturePrefixes`, `InvoiceLineView`) that today live in vendor files and read `vendor.pricing.*` locale keys. Both apps need them, so they become a third Nuxt layer that itself extends `@nasq/ui`. Vendor-only code (`vendorSubscriptions`, `vendorPackages`, `vendorPolicy`, `vendorTenantPlan`, vendor pages/components, `vendor.json`) goes to `apps/vendor-admin`.
- **D2 — no `/vendor` route prefix.** The whole app is the vendor console: pages move from `pages/vendor/**` to `pages/**` (`/overview`, `/customers`, `/tenants`, `/operations`, `/plans`, `/bundles`, `/catalog`, `/invoices`, `/audit`, plus new `/team`, `/login`, `/enroll`). Every link, test and acceptance spec is rewritten; a test forbids `'/vendor/` page paths in the new app. The BFF keeps the API prefix `/api/vendor/v1/**` (it names the upstream surface, not a page).
- **D3 — code removal from `apps/web` happens in this phase** (not phase 4), because `apps/web` cannot build with dangling imports. Phase 4 shrinks to: `tools/arch_layers.json` gate removal (owner trailer), `AGENTS.md` R5 wording, the active-doc list in the spec, and the final owner sign-off.
- **D4 — step-up is an inline panel, not a dialog** (DESIGN.md forbids stacking business dialogs); the browser's own passkey prompt is native UI.
- **D5 — TOTP setup shows the setup key and the `otpauth://` link; no QR library** (no new dependency).

## Global Constraints

- Branch `codex/cp-vendor-admin-app`, worktree `.worktrees/cp-vendor-admin-app`, created from `codex/cp-vendor-identity` with `codex/web-ui-layer` and current `main` merged in (Task 1). Node 22 (`export PATH=/opt/homebrew/opt/node@22/bin:$PATH`). Commit scope `cp` for vendor-admin and control-plane files, `web` for `apps/web`, `tools`/`deploy`/`docs` as usual; ≤72 chars, one logical change per commit.
- Implementers use model `sonnet`.
- Cookie: name `__Host-nasq_admin` with `HttpOnly; Secure; SameSite=Strict; Path=/` when `adminOrigin` is `https:`; on a loopback `http:` origin (dev only) the name is `nasq_admin` and `Secure` is omitted. Value = the control plane's `session` string exactly (`<accountId>.<43-char token>`); `Max-Age` = seconds until `expires_at`.
- BFF env (Nuxt private runtimeConfig, set from `NUXT_CONTROL_URL`, `NUXT_SERVICE_KEY`, `NUXT_INSTALLATION_ID`, `NUXT_ADMIN_ORIGIN`, `NUXT_TRUST_PROXY`): `controlUrl`, `serviceKey` (≥32 bytes, equals the control plane's `CONTROL_SERVICE_KEY`), `installationId` (equals `CONTROL_INSTALLATION_ID`), `adminOrigin`, `trustProxy` (boolean). Missing/short key → every API route answers `503 { code: 'vendor_unavailable' }`. Control plane additionally needs `ADMIN_SECRET_KEY`, `ADMIN_RP_ID`, `ADMIN_ORIGIN` (phase 2).
- Anonymous routes (`/v1/admin/auth/*`) are signed with `signServiceRequest({ method:'POST', path, body, actor:'anonymous', anonymous:true, issuer, key })`; all others with `actor = Number(session.split('.')[0])` plus header `x-nasq-session`. `x-nasq-client-ip` is always overwritten from `getRequestIP(event, { xForwardedFor: trustProxy })`; a browser-supplied value is never forwarded. The browser cookie is never forwarded upstream.
- Error contract passed through unchanged: auth routes `{ code }` with `auth_failed` (401) / `rate_limited` (429) / `invalid` (422) / `admin_unavailable` (503) / `not_found` (404); API routes `403 { code: 'step_up_required' }` triggers the inline step-up; `401` clears the local session and goes to `/login`.
- No `$fetch` to any Odoo path, no `apps/web` import, no control-plane import except `@nasq/commercial-contracts` (types, `/server` for signing).
- Locale: Arabic default, RTL; all user-facing strings through `t()` in the `vendor` namespace (moved) or a new `adminAuth` namespace; enrollment token and recovery codes never logged, stored, or placed in query strings (token read from `location.hash`, then removed with `history.replaceState`).
- Ports: vendor-admin dev `3100`, scratch Nuxt for checks `3103`, mock control service `4701`. Never touch :3000/:8069/odoo19/`nasq_control_dev`.

## Review Focus

1. A forged or mismatched cookie reaching the control plane unsigned or signed with the wrong actor (anonymous vs numeric) → BFF contract tests verify every BFF-signed request with `verifyServiceRequest`, both modes, and a tampered-cookie case. Tasks 4, 5.
2. Open redirect or token leakage after login/enrollment (`next` parameter, URL fragment, history, logs) → tests on `safeReturnTo`, fragment removal, and a log-scan test. Task 5.
3. Step-up retry loops (a request retried forever, or a failed passkey leaving the page stuck) → exactly one retry, cancelled prompt leaves the form intact. Task 5.
4. The customer `/subscription` pages break after the commercial-ui move or lose `vendor.pricing.*` strings → screenshot compare of apps/web plus locale-resolution test. Tasks 2 and 9.
5. Dangling vendor code or config left in `apps/web` (runtime keys, nav items, `/odoo` console entry, `vendorCapabilities`, locale file, e2e specs) → repo-wide `rg` gate and `tools/arch_policy.py` baseline shrink. Task 9.

---

### Task 1: Branch setup, spec addendum, master plan update

**Files:**
- Modify: `docs/superpowers/specs/2026-10-15-nasq-vendor-admin-separation-design.md` (append "Addendum 2026-10-16": D1-D5 above, the 5-line summary only), `docs/superpowers/plans/2026-10-15-vendor-admin-separation-master.md` (phase table: phase 3 row links this plan, phase 4 row becomes "docs, `arch_layers.json` gate removal, sign-off")
- No product code.

- [ ] **Step 1:** From the main checkout run `git worktree list`, then `git worktree add .worktrees/cp-vendor-admin-app -b codex/cp-vendor-admin-app codex/cp-vendor-identity`. In it: `git merge --no-edit codex/web-ui-layer` then `git merge --no-edit main`; resolve conflicts keeping both sides' intent (phase 1 moved files; main may have touched them — apply main's change at the new path). Then `npm ci --ignore-scripts` (npm 11 from the default PATH is only needed when a lockfile changes).
- [ ] **Step 2:** Run the checks that must already be green on the merged base and record the numbers in the report: `nuxt prepare` then `npm -w apps/web run lint`; `npm test`; `CONTROL_TEST_DATABASE_URL=postgres://127.0.0.1/nasq_control_scratch_p3 npm -w apps/control-plane test` (create that scratch database first; baseline failures are the known five files — compare with the phase 2 report); `python3 -B tools/arch_policy.py --base main`.
- [ ] **Step 3:** Append the addendum and update the master plan table; commit `docs(docs): record phase 3 decisions` (do not touch `AGENTS.md`).

---

### Task 2: Extract `packages/commercial-ui` (shared billing presentation)

**Files:**
- Create: `packages/commercial-ui/{package.json,nuxt.config.ts,vitest.config.ts}`, `packages/commercial-ui/i18n/locales/{ar,en}/commercial.json`
- Move (git mv, with tests): `apps/web/app/components/shared/commerce/PriceBreakdown.vue` → `packages/commercial-ui/app/components/PriceBreakdown.vue` (registered as `SharedCommercePriceBreakdown`), `apps/web/app/components/shared/data/InvoiceLines.vue` → `…/InvoiceLines.vue` (`SharedInvoiceLines`), `apps/web/app/utils/{invoiceLines,commercialBadges,entitlementApps}.ts` → `packages/commercial-ui/app/utils/`, and from `apps/web/app/utils/vendorCommercial.ts` only the exports used by customer code (`cadenceLabel`, `formatVendorMoney`, `quoteLinesByTiming` and what they need) → `packages/commercial-ui/app/utils/commercial.ts` (rename `formatVendorMoney` → `formatMoney`; update every caller); the rest of `vendorCommercial.ts` stays for Task 7.
- Move generic helpers to the phase 1 layer if both apps need them and they are presentational: `statusBadge.ts`, `labelFallback.ts`, `safeReturnTo.ts` → `packages/ui/app/utils/` (check each for app knowledge first; `safeReturnTo` must stay route-agnostic).
- Modify: `apps/web/nuxt.config.ts` (`extends: ['@nasq/ui', '@nasq/commercial-ui']` — a layer may extend `@nasq/ui` itself; use whichever form Nuxt resolves and say which), `apps/web` subscription pages and tests, `apps/web/i18n/locales/{ar,en}/vendor.json` (move the `vendor.pricing.*` keys that the moved files read into `commercial.json` under a neutral root `commercial.pricing.*` and update the `t()` calls; the customer app keeps its `subscription.json`), `tools/ui_policy.py` / `ui_catalog.mjs` / `no_external_refs.py` / `ui_templates.mjs` / `check_fast.py` to scan the new package the way phase 1 did for `packages/ui`.
- Test: `packages/commercial-ui/test/{layer,i18n}.test.ts`, the moved unit tests.

**Interfaces:**
- Produces: components `SharedCommercePriceBreakdown`, `SharedInvoiceLines`; utils `formatMoney`, `cadenceLabel`, `quoteLinesByTiming`, `invoiceStatusBadge`, `entitledFeaturePrefixes`, type `InvoiceLineView`, `invoiceLineQuantities` — imported as `@nasq/commercial-ui/app/...` (same deep-import style as `@nasq/ui`).

- [ ] **Step 1:** For each moved file list its imports first; anything customer-/vendor-specific (route literals, `useMe`, vendor capability names) stays out. Report what stayed and why.
- [ ] **Step 2: Failing tests** like phase 1's `layer.test.ts`/`components.test.ts`/`i18n.test.ts` (no `@/`, `~/`, `apps/` imports; every `t()` key resolves from `commercial.json`; no key duplicated in `apps/web` locale files; ar/en equal). Run → FAIL.
- [ ] **Step 3:** Move, rewrite importers (`rg -l` for each moved path across `apps/web`, `apps/web/stories`, `apps/web/e2e`), update tooling and catalog, regenerate `docs/design-system/catalog.json`.
- [ ] **Step 4: Verify** `nuxt prepare` + lint, `npm test`, `npm -w apps/web run build`, `npm -w apps/web run build-storybook`, `ui_policy`, `ui_catalog --check`, tools unittest, and a same-day screenshot capture of apps/web before/after with `tools/ui_layer_baseline.mjs` (add the routes `/subscription` and `/subscription/invoices` to the route list in the tool only if the mock can render them without the commercial runtime; otherwise add a Vitest render test of `SharedCommercePriceBreakdown`/`SharedInvoiceLines` and say so). Exit 0 required.
- [ ] **Step 5: Commit** `refactor(web): move shared billing presentation into commercial-ui` (+ separate `build(tools): ...` commit).

---

### Task 3: Scaffold `apps/vendor-admin`

**Files:**
- Create: `apps/vendor-admin/{package.json,nuxt.config.ts,tsconfig.json,vitest.config.ts}` (the README belongs to Task 10A), `apps/vendor-admin/app/app.vue`, `apps/vendor-admin/app/error.vue`, `apps/vendor-admin/i18n/localeFiles.ts` (copy the discovery approach of `apps/web/i18n/localeFiles.ts`), `apps/vendor-admin/i18n/locales/{ar,en}/adminAuth.json` (empty-but-valid namespaces now; filled in Task 5), `apps/vendor-admin/public/{favicon.ico,robots.txt}` (robots: `Disallow: /`)
- Modify: root `package.json` (workspace already covered by `apps/*`; add `npm -w apps/vendor-admin run test` to `test`), `package-lock.json` (npm 11 from default PATH; additions only), `.claude/launch.json` is git-ignored — do not touch.
- Test: `apps/vendor-admin/app/__tests__/boot.test.ts`

**Interfaces:**
- Produces: a Nuxt app that boots with `extends: ['@nasq/ui', '@nasq/commercial-ui']`, registers `@nuxtjs/i18n` (Arabic default, `strategy: 'no_prefix'` like apps/web — read `apps/web/nuxt.config.ts` for the exact settings and copy only what applies), the `icon` client-bundle config from `apps/web/nuxt.config.ts` (`provider: 'none'`, `fallbackToApi: false`, `clientBundle.scan`) with `@iconify-json/lucide` as a dependency, `runtimeConfig` keys from Global Constraints (all empty/false by default), `routeRules` security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` on `/api/**`), and dev port 3100.

- [ ] **Step 1: Failing test** `boot.test.ts`: reads `nuxt.config.ts` (stub `defineNuxtConfig` as identity) and asserts `extends` contains both layers, `ssr` default, runtimeConfig defaults are empty, headers rules exist, and `app.vue` provides `<UApp>` with the i18n locale.
- [ ] **Step 2: Implement.** `app.vue` follows `apps/web/app/app.vue`: `UApp` with Nuxt UI locale per i18n locale, `useLocaleHead`/html `lang` and `dir`, appearance (`.dark` class and font size) via the same `htmlAttrsFor` helper that apps/web uses — if that helper is app-owned, move it to `packages/ui/app/utils/appearance.ts` first (phase 1 final review item 2 of the checklist) and import it from both apps. No page-area provider needed (default neutral).
- [ ] **Step 3: Verify** `npm -w apps/vendor-admin run test`, `nuxt prepare`, `npx nuxt build` from `apps/vendor-admin` (a page `pages/index.vue` that renders the product name is enough for now), then run the production output on port 3103 and confirm fonts (`/fonts/IBMPlexSansArabic-Regular.woff2` → 200), `<html lang="ar" dir="rtl">`, and the security headers with `curl -i`.
- [ ] **Step 4 (parallel-schedule addition):** the scaffold task also creates the two composables other tasks code against, minimal and per the Task 5 interfaces: `apps/vendor-admin/app/composables/useAdminSession.ts` (loads `GET /api/auth/session`, `me`, `can`, `refresh`, `signOut` via `POST /api/auth/logout`) and `apps/vendor-admin/app/composables/useAdminApi.ts` (`request<T>(path, opts)` to `/api/vendor/v1/...` with the 401 → sign-out + `/login?next=` handling only; Task 5 adds the step-up retry to this same file). Until the BFF routes exist (Task 4, same agent) they are covered by unit tests with `$fetch` stubbed.
- [ ] **Step 5: Commit** `feat(cp): scaffold the vendor admin app on the ui layers`.

---

### Task 4: BFF — session cookie, signing, auth and API proxy routes

**Files:**
- Create: `apps/vendor-admin/server/utils/{control.ts,session-cookie.ts,origin.ts,client-ip.ts,errors.ts}`, `apps/vendor-admin/server/api/auth/{passkey-options,passkey-verify,fallback,recovery,logout,session,step-up-options,step-up-verify}.post.ts` (+ `session.get.ts`), `apps/vendor-admin/server/api/auth/enroll/{invitation,passkey-options,passkey-verify,totp,complete}.post.ts`, `apps/vendor-admin/server/api/vendor/v1/[...path].ts`
- Move+adapt: `apps/web/server/utils/vendor-signature.ts` and the forward/limits logic of `apps/web/server/utils/vendor-control.ts` (the 1 MB body cap, JSON-object check, redirect:error, 10 s timeout, 4xx pass-through, 503 `vendor_unavailable` on other failures) into `control.ts`.
- Test: `apps/vendor-admin/server/utils/__tests__/{control-contract,session-cookie,origin,client-ip,proxy}.test.ts`

**Interfaces:**
- Produces:
  - `controlCall(event, { path, method, body?, session?, anonymous? }): Promise<{ status:number; data:unknown }>` — builds the signed request exactly as in Global Constraints, sets `x-nasq-client-ip` and (when `session`) `x-nasq-session`, never forwards cookies.
  - `readSession(event): { accountId:number; value:string } | null` (validates `^[1-9][0-9]{0,15}\.[A-Za-z0-9_-]{43}$`), `writeSession(event, session, expiresAt)`, `clearSession(event)`.
  - `assertSameOrigin(event)` (JSON content-type, `sec-fetch-site` same-origin/none, `Origin === adminOrigin`; applies to every non-GET).
  - Each auth route: `assertSameOrigin` → zod-validate body (reuse the field limits of phase 2's `routes.ts`) → `controlCall` → on success from `passkey-verify`, `fallback`, `recovery`, `enroll/complete` call `writeSession` and return only `{ expires_at, idle_expires_at }` (plus `recovery_codes` for `enroll/complete`); the raw `session` string never reaches the browser body.
  - `GET /api/auth/session` → `controlCall('/v1/admin/me', session)` or `401 { code:'auth_failed' }`.
  - Proxy `/api/vendor/v1/**` → same forward rules as today with the session cookie required (`401` without it).

- [ ] **Step 1: Failing contract tests** (`control-contract.test.ts`): build the BFF's request headers for (a) anonymous POST and (b) actor 7 + session, then feed them to `verifyServiceRequest` from `@nasq/commercial-contracts/server` with the same key and assert (a) verifies only with `anonymous: true` and returns `actor:'anonymous'`, (b) verifies without it and returns actor 7; a tampered body, path, or actor fails; a replayed nonce is the control plane's job (not tested here). `session-cookie.test.ts`: https origin gives `__Host-nasq_admin` + `Secure; HttpOnly; SameSite=Strict; Path=/`, loopback http gives `nasq_admin` without `Secure`; malformed values rejected; `Max-Age` from `expires_at`. `client-ip.test.ts`: a browser `x-nasq-client-ip` header is ignored; `x-forwarded-for` is used only when `trustProxy`. `proxy.test.ts`: no cookie → 401; mismatched cookie → forwarded as is (the control plane decides) but actor prefix equals the cookie id; upstream 403 `step_up_required` body passes through; upstream 5xx → 503 `vendor_unavailable`; body > 1 MB → 413; non-object JSON → 400; cross-site request → 403 `cross_site_request`. Run → FAIL.
- [ ] **Step 2: Implement** with `h3` helpers (`getCookie`, `setCookie`, `deleteCookie`, `getRequestIP`, `readRawBody`). `serviceKey` shorter than 32 bytes or empty `controlUrl` → 503 for every route. The control URL must be `https:` or loopback `http:` (copy `vendorControlBase`). Errors: never include upstream text in logs; log only route name and status.
- [ ] **Step 3: Verify** `npm -w apps/vendor-admin run test`, build, and a log-scan test: run one request containing a recognizable fake token through each route with `console.*` spied; assert the token appears in no log call.
- [ ] **Step 4: Commit** `feat(cp): add the vendor admin BFF with session cookie and signed forwarding`.

---

### Task 5: Sign-in, enrollment, step-up and session UI

**Files:**
- Create: `apps/vendor-admin/app/composables/{useAdminSession,useStepUp,useAdminApi}.ts`, `apps/vendor-admin/app/middleware/{00.auth.global.ts,capability.ts}`, `apps/vendor-admin/app/pages/{login.vue,enroll.vue}`, `apps/vendor-admin/app/components/{PasskeyButton.vue,TotpSetup.vue,RecoveryCodes.vue,StepUpPanel.vue}`, `apps/vendor-admin/i18n/locales/{ar,en}/adminAuth.json`
- Modify: `apps/vendor-admin/package.json` (`@simplewebauthn/browser` exact `14.0.0`, npm 11 install, additions only)
- Test: `apps/vendor-admin/app/**/__tests__/*.test.ts`, `apps/vendor-admin/e2e/auth.spec.ts`, `apps/vendor-admin/e2e/mock-control.mjs`, `apps/vendor-admin/playwright.config.ts`

**Interfaces:**
- `useAdminSession(): { me: Ref<{id,email,display_name,roles,capabilities}|null>; ready: Promise<void>; can(cap): boolean; refresh(): Promise<void>; signOut(): Promise<void> }` (state keyed by `useState`, loaded from `GET /api/auth/session`).
- `useAdminApi().request<T>(path, opts)` → `$fetch` to `/api/vendor/v1/...` that (a) on `403 {code:'step_up_required'}` opens the step-up panel through `useStepUp`, awaits one passkey assertion, retries the request exactly once, (b) on `401` clears `me` and navigates to `/login?next=<safeReturnTo>`.
- `useStepUp(): { pending: Ref<boolean>; error: Ref<string|null>; run<T>(fn:()=>Promise<T>): Promise<T> }` driven by `/api/auth/step-up-options` then `/api/auth/step-up-verify` with `startAuthentication` from `@simplewebauthn/browser` (options JSON from the server as `{ optionsJSON }` — check the v14 browser API in `node_modules` and adapt).
- Middleware `00.auth.global`: pages with `definePageMeta({ public: true })` (login, enroll) skip; others require `me` (else `/login?next=…` through `safeReturnTo`); `capability` middleware reads `to.meta.capability` and responds 403 via `createError`.
- `login.vue`: primary "Sign in with passkey" (`/api/auth/passkey-options` → `startAuthentication` → `/api/auth/passkey-verify`); secondary disclosure "Lost your device?" → password + TOTP form, and "Use a recovery code" → password + recovery code form; generic error text for every `auth_failed`, a distinct message for `rate_limited`; after success `await refresh()` then `navigateTo(safeReturnTo(next) ?? '/')`.
- `enroll.vue`: reads `location.hash` (`#<43-char token>`), immediately `history.replaceState` to remove it, calls `/api/auth/enroll/invitation`; steps: register passkey (`enroll/passkey-options` + `startRegistration` + `enroll/passkey-verify` with a device label field), show the TOTP setup key and `otpauth://` link (`enroll/totp` returns `totp_uri` and an opaque `totp_box` kept only in component state), password + code form (`enroll/complete`), then `RecoveryCodes` shown once with a "I saved them" checkbox gating the continue button; codes live only in component state.
- `StepUpPanel.vue`: inline panel (no dialog) rendered by the default layout above the page content while `pending`; shows "Confirm with your passkey", Retry/Cancel; cancel rejects the original request with a typed `StepUpCancelled` error that the calling form shows as an inline message.

- [ ] **Step 1: Failing unit tests:** `useAdminApi` retries exactly once after a successful step-up and not at all after cancel or after a second `step_up_required`; 401 clears session and routes to login with a sanitized `next` (`//evil.example`, `javascript:`, absolute URLs rejected → `/`); `enroll` removes the fragment before any network call; recovery codes are not present in `localStorage`/`sessionStorage`/URL; middleware allows only `public` pages when signed out.
- [ ] **Step 2: Mock control service** `e2e/mock-control.mjs` (port 4701): implements `/v1/admin/auth/*` and `/v1/admin/me` per the phase 2 contract, **verifying every request signature with `verifyServiceRequest`** (anonymous vs numeric exactly as the real service), a stub WebAuthn that accepts the virtual authenticator's attestation/assertion shape without cryptographic verification (mark clearly as a mock; real verification is Task 11), canned `step_up_required` on a configurable route.
- [ ] **Step 3: Playwright** (`auth.spec.ts`, run against the production build on 3103 + mock): add a CDP virtual authenticator (`WebAuthn.enable` + `addVirtualAuthenticator`, ctap2, internal, resident keys, user verification on); flows: enroll from a hash link (assert fragment gone, recovery codes shown once, redirected into the app); sign-in with passkey; sign-in via password+TOTP; wrong password shows the same message as unknown email; 6th failure shows the rate-limit message; protected page redirects to `/login?next=`; step-up retry on a mutating call; logout clears the cookie; Arabic RTL and English LTR screenshots at 390/768/1440.
- [ ] **Step 4: Implement** the files above; strings in `adminAuth.json` (ar+en, identical key sets; add a test like phase 1's i18n test).
- [ ] **Step 5: Commit** `feat(cp): add vendor admin sign-in, enrollment and step-up`.

---

### Task 6: App shell and navigation

**Files:**
- Create: `apps/vendor-admin/app/layouts/default.vue`, `apps/vendor-admin/app/components/{AdminHeader,AdminMobileNav}.vue`, `apps/vendor-admin/app/utils/adminNav.ts`, `apps/vendor-admin/app/composables/useAdminNav.ts`
- Test: `apps/vendor-admin/app/utils/__tests__/adminNav.test.ts`, `apps/vendor-admin/e2e/shell.spec.ts`

**Interfaces:**
- `adminNav(capabilities): ShellRailItem[]` (type from `@nasq/ui/app/types/shell`) returning only permitted sections in this order with these capabilities: overview `vendor.read`; customers `vendor.read`; tenants `vendor.read`; operations `vendor.read`; plans `vendor.read`; bundles `vendor.read`; catalog `vendor.read`; invoices `vendor.billing.manage`; audit `vendor.audit.read`; team `vendor.accounts.manage`; each `{ id, labelKey, icon, to, external:false }` with labelKeys under `vendor.nav.*` (the existing `vendor.*.title` strings are reused — grep `apps/web/app/composables/nav/shellModules.ts` lines ~145-153 for the labels/icons and move that mapping).
- Layout: `ShellFrame` with `no-sidebar`, `ModuleRail` (from the layer) at inline-start, `AdminHeader` (brand wordmark, page title/breadcrumb via the layer's `usePageHeader`, account menu: display name, roles, language and appearance menus copied in spirit from `apps/web`'s `AppearanceMenu` only if they are generic — otherwise a compact version, sign-out), `StepUpPanel` slot, and `AdminMobileNav` (a `UDropdownMenu`/slide list of the same items) shown below 768 px where the rail is hidden. Keyboard: no global shortcuts in this phase.

- [ ] **Step 1: Failing tests** for `adminNav` (each role from the spec's role table yields exactly its sections: `support` gets overview…catalog + audit, not invoices/team; `finance` gets invoices; `owner` gets all ten).
- [ ] **Step 2: Implement; Step 3: Playwright** `shell.spec.ts` against the mock: rail items per role, active item highlight, 390 px mobile menu opens and navigates, sign-out menu item works, Arabic/English, light/dark screenshots at 390/768/1440 (check them visually with the Read tool and describe them in the report).
- [ ] **Step 4: Commit** `feat(cp): add the vendor admin shell and role-based navigation`.

---

### Task 7: Move vendor pages, components, composables, utils, locale and tests

**Files (git mv; list is exhaustive for pages/components, re-check with `rg` before moving):**
- `apps/web/app/pages/vendor/**` → `apps/vendor-admin/app/pages/**` dropping the `vendor/` level: `audit.vue`, `bundles.vue`, `bundles/{index,new,[id]}.vue`, `bundles/[id]/edit.vue`, `catalog.vue`, `catalog/{index,new,[id]}.vue`, `catalog/[id]/edit.vue`, `customers.vue`, `customers/{index,[id]}.vue`, `customers/[id]/change.vue`, `customers/[id]/terms/new.vue`, `index.vue`, `invoices.vue`, `invoices/{index,[id]}.vue`, `operations/{index,[id]}.vue`, `overview.vue`, `plans.vue`, `plans/{index,new,[id]}.vue`, `plans/[id]/edit.vue`, `tenants/{index,new,[id]}.vue`; tests `pages/vendor/__tests__/*` → `apps/vendor-admin/app/pages/__tests__/`.
- `apps/web/app/components/vendor/*` (9 files) → `apps/vendor-admin/app/components/` (auto-import prefix `Vendor` is kept: register the folder with `prefix: 'Vendor'` as apps/web did, so templates need no rename).
- `apps/web/app/composables/{useVendorApi,useVendorCommercial,useVendorSubscriptions,useVendorContext,useSharedTenantOnboarding}.ts`, `apps/web/app/utils/{vendorCommercial (rest),vendorSubscriptions,vendorPackages,vendorPolicy,vendorTenantPlan}.ts` and their tests → `apps/vendor-admin/app/{composables,utils}/`.
- `apps/web/i18n/locales/{ar,en}/vendor.json` → `apps/vendor-admin/i18n/locales/{ar,en}/vendor.json` (minus the `vendor.pricing.*` keys that Task 2 moved).
- Modify (after the move): every `to="/vendor/…"`, `navigateTo('/vendor…')`, `href`, test and fixture path → root paths; `definePageMeta({ middleware: 'vendor', vendorCapability: 'X' })` → `definePageMeta({ capability: 'X' })`; `useVendorContext` keeps its return shape (`can`, `capabilities`, `sharedOnboardingEnabled`, `ready`, `refresh`, `pending`, `error`) but its `enabled` flag is always true, its identity comes from `useAdminSession().me.id`, `VENDOR_CAPABILITIES` gains `'vendor.accounts.manage'`, and it loads `/api/vendor/v1/context`; `useVendorApi` now delegates to `useAdminApi` (so step-up and 401 handling apply to every call).
- Test: moved tests plus `apps/vendor-admin/app/__tests__/routes.test.ts` (no `'/vendor/` page path literal remains; every page has `capability` meta or `public`).

- [ ] **Step 1: Failing `routes.test.ts`** → FAIL. **Step 2:** move with `git mv`, rewrite imports to relative/`@nasq/…` forms and `@/` (the app's own alias) as appropriate, rewrite routes mechanically (`rg -n "/vendor" apps/vendor-admin` must return only `/api/vendor/v1` and the BFF routes).
- [ ] **Step 3: Verify** `nuxt prepare`, `npm -w apps/vendor-admin run test`, `npx nuxt build`, and render every page against the mock control service for a user with all capabilities (Playwright smoke: each route returns 200, has an `h1`, no console errors, no raw i18n keys, and for a restricted role the forbidden state, an empty list state and an upstream-error state each render with their `Shared*State` component — assert no text matches `/^(vendor|adminAuth|app|states)\.[a-zA-Z.]+$/`). Port the existing mock-backed vendor e2e specs: move `apps/web/e2e/tasmim6-vendor-*.spec.ts`, `tasmim6-commercial-smoke.spec.ts`, `tasmim7-commercial-date-hydration.spec.ts`, `commercial-mock-routes.mjs` and the vendor parts of the mock that serve `/api/vendor/v1/**` to `apps/vendor-admin/e2e/` (`rg -l "/vendor|api/vendor" apps/web/e2e` is the list; `tasmim6-price-breakdown` stays with the customer app if it only exercises `/subscription`), adapting them to log in through the mock control service; they must pass.
- [ ] **Step 4: Commit** (two commits) `refactor(cp): move the vendor pages into the vendor admin app` and `test(cp): move the vendor e2e specs to the vendor admin app`.

---

### Task 8: Team page (accounts, invitations, roles)

**Files:**
- Create: `apps/vendor-admin/app/pages/team/index.vue`, `apps/vendor-admin/app/components/{AccountForm,AccountRow,InvitationLink}.vue`, `apps/vendor-admin/app/composables/useAdminAccounts.ts`, strings under `vendor.team.*` in `apps/vendor-admin/i18n/locales/{ar,en}/vendor.json`
- Test: `apps/vendor-admin/app/pages/team/__tests__/team.test.ts`, `apps/vendor-admin/e2e/team.spec.ts`

**Interfaces (all through `useAdminApi`, so mutations get step-up automatically):**
- `GET /api/vendor/v1/admin/accounts` → `{ items:[{id,email,display_name,status,roles,passkeys,last_seen_at}], total }`.
- `POST /api/vendor/v1/admin/accounts` `{ email, display_name, roles, reason }` → `201 { id, invitation_token, expires_at }`; the page builds the link `${location.origin}/enroll#${token}` and shows it once with a copy button and the expiry (`InvitationLink`); the token is not stored anywhere.
- `POST …/admin/accounts/:id/roles {roles, reason}`, `…/disable {reason}`, `…/reset {reason}` (returns a new link, shown the same way).
- UI rules: list with `SharedDataTable`; roles shown by the six Arabic role names (ar/en strings for `owner customer_success finance product operations support`); multi-select of roles; **reason field required (3–1000 chars)** on every mutation; destructive actions (disable, reset) use inline confirmation (`SharedInlineConfirm`), never a dialog; `last_owner` (409) shows "at least one active owner is required"; `conflict` (409) shows "an account with this email already exists"; the page and nav item require `vendor.accounts.manage`.

- [ ] **Step 1: Failing tests:** nav hides Team without the capability; mutations send the reason; disable of the last owner shows the last-owner message; invitation link displays once and disappears on navigation; roles select only offers the six keys.
- [ ] **Step 2: Implement; Step 3: Playwright** against the mock (extend the mock with the accounts routes and 409 cases): invite → copy link → open it in a second context → enroll (reusing Task 5 flow) → appears active; step-up appears before the first mutation when the mock says so. Screenshots ar/en, 390/768/1440, viewed and described.
- [ ] **Step 4: Commit** `feat(cp): add the vendor admin team page`.

---

### Task 9: Remove vendor code and config from `apps/web`

**Files (delete or edit; confirm each with `rg -n -i vendor apps/web --glob '!**/node_modules/**'` before and after):**
- Already moved in Tasks 2 and 7. Delete the rest: `apps/web/server/api/vendor/**`, `apps/web/server/utils/{vendor-control.ts,vendor-signature.ts}` and their tests (`vendor-outage.test.ts`, `vendor-control.test.ts`, `vendor-signature.test.ts`), `apps/web/app/middleware/vendor.ts`.
- Edit: `apps/web/nuxt.config.ts` (remove `vendorWorkspaceEnabled`, `vendorControlUrl`, `vendorServiceKey`, `vendorInstallationId`, `vendorPublicOrigin` from both `runtimeConfig` blocks and the `/odoo/**` proxy rule only if it exists solely for the console — check; the dedicated break-glass rule stays per the spec), `apps/web/app/composables/nav/{shellModules,sidebarModel,activeRoute,createActions}.ts` (drop the `management` rail entry, the `/odoo` console item, `vendorConsoleItem`, the `vendor` module list and `role === 'vendor'` branch), `apps/web/app/components/shell/ShellHeader.vue` (console badge), `apps/web/app/modules/registry.ts`, `apps/web/app/composables/useWorkspaceIdentity.ts` and `apps/web/app/utils/accessPolicy.ts` (remove `vendorCapabilities` and the `vendor.` branch), `apps/web/i18n/locales/{ar,en}/common.json` (`nav.management`, `nav.console`, `nav.consoleBadge`, rail strings that nothing reads), `apps/web/tests/localeFiles.test.ts` (no `vendor` namespace), `apps/web/app/components/shared/commerce` leftovers, stories/e2e that name vendor, `docs/design-system/catalog.json` (regenerate).
- Rewrite baseline: `python3 -B tools/arch_policy.py --write-baseline` (it must only shrink: the six `commercial import apps/web/app/...vendor...` entries disappear); do NOT edit `tools/arch_layers.json` (phase 4, owner trailer).
- Test: new `apps/web/tests/noVendor.test.ts` asserting by file scan that `apps/web/app`, `apps/web/server`, `apps/web/i18n`, `apps/web/nuxt.config.ts` contain no `vendorWorkspace`, `useVendor`, `/api/vendor`, `pages/vendor`, `vendorCapabilit` (the break-glass `/odoo` rule is the only allowed `odoo` console path and must carry no navigation entry).

- [ ] **Step 1: Failing `noVendor.test.ts`** → FAIL. **Step 2:** delete/edit; run `nuxt prepare`, lint, `npm test`, `npm -w apps/web run build`, `build-storybook`, `ui_policy`, `ui_catalog --check`, `arch_policy --base main`, `git_policy --base main`.
- [ ] **Step 3: apps/web screenshot proof:** same-day `tools/ui_layer_baseline.mjs` capture of the base (this branch's merge base with `main`, via a temporary detached worktree as in phase 1's final compare) vs HEAD, compare exit 0. If the mock user is a vendor and the rail differs, the only acceptable difference is the removed vendor rail items — view the differing pairs and describe them; anything else is a defect.
- [ ] **Step 4: Commit** `refactor(web): remove the vendor console from the customer app` and `build(tools): shrink the arch baseline after the vendor move`.

---

### Task 10: Tooling, policy, deployment config and docs for the new app

(Split for parallel work: **10A** = `tools/arch_policy.py` rule VA1 + tests, `.woodpecker.yml`, `apps/vendor-admin/Dockerfile`, `apps/vendor-admin/README.md`, `deploy/**` env/edge, runbook/docs, acceptance-spec text; **10B** = the scan-root extensions in `tools/ui_policy.py`, `no_external_refs.py`, `ui_templates.mjs`, `check_fast.py`(+tests) and any vendor-path cleanup in `tools/ui_inventory.py`/`ui_catalog.mjs`. 10B runs after Tasks 3 and 7; it is the only task allowed to edit those five tool files after Task 2.)

**Files:**
- Modify: `tools/arch_policy.py` (+ tests): rule `VA1` — files under `apps/vendor-admin` (excluding tests) may import only relative paths, `@nasq/ui`, `@nasq/commercial-ui`, `@nasq/commercial-contracts`, and npm packages; no `apps/web`, `odoo-addons`, `@nasq/contracts`, no path matching `/api/v1/` Odoo routes (hard failure, never baselined); and `apps/web` must not import `apps/vendor-admin`; `tools/ui_policy.py` (`APP_SOURCES`, scopes, manifests include `apps/vendor-admin/package.json`), `tools/no_external_refs.py` ROOTS (`apps/vendor-admin/app`, `server`, `public`, `nuxt.config.ts`), `tools/ui_templates.mjs`, `tools/check_fast.py` (+ `test_check_fast.py`), `.woodpecker.yml` (lint/test/build steps for `apps/vendor-admin` modeled on the `apps/web` ones; read the pipeline test `deploy/test_woodpecker_pipeline.py` and keep it green), `apps/web/.storybook` only if stories for new shared things are added.
- Create: `apps/vendor-admin/Dockerfile` (same shape as `apps/web/Dockerfile`: copy `packages/ui`, `packages/commercial-ui`, `packages/commercial-contracts`, `apps/vendor-admin` manifests; port 3100), `deploy/control-plane/env.example` additions (`ADMIN_SECRET_KEY`, `ADMIN_RP_ID`, `ADMIN_ORIGIN`) and a `deploy/vendor-admin/env.example` (`NUXT_CONTROL_URL`, `NUXT_SERVICE_KEY`, `NUXT_INSTALLATION_ID`, `NUXT_ADMIN_ORIGIN`, `NUXT_TRUST_PROXY` — these map to the private runtimeConfig keys `controlUrl`, `serviceKey`, `installationId`, `adminOrigin`, `trustProxy`; the key is deliberately not named `publicOrigin`, because `NUXT_PUBLIC_ORIGIN` would collide with the `runtimeConfig.public.*` mapping), an edge snippet for the `admin` host (read `deploy/Caddyfile` for style; only the new server block, no existing block changed), and `apps/vendor-admin/README.md` (what it is, env table, local run, how the BFF relates to the control plane, the `x-nasq-client-ip` rule).
- Modify docs: `docs/operations/saas-commercial-runbook.md` (section «حسابات لوحة تحكم نسق»: the `bootstrap-owner` link now opens `<admin origin>/enroll#…`; add the steps to run vendor-admin locally), `docs/agents/web-rules.md` (one paragraph: `apps/vendor-admin` follows DESIGN.md and uses the same layers), `docs/WORKSPACE.md` (one dated line). Do NOT edit `AGENTS.md`, `DESIGN.md` §9 or the 9-document list of the spec (phase 4).
- Update acceptance harness text only (cannot be run here): `tools/saas_commercial_acceptance/{first-tenant.spec.mjs,commercial-pages.spec.mjs,commercial-journey.spec.mjs}` and `tools/shared_saas_lifecycle/{first-tenant.spec.mjs,restore.spec.mjs}` — vendor URLs `/vendor/...` → the new host/paths, sign-in through the new login (document that these now need a bootstrapped owner and a virtual authenticator; mark them **not run** in the report).
- Test: arch policy tests (violation fixtures for each VA1 clause), `deploy/test_woodpecker_pipeline.py`, `tools/test_*.py`.

- [ ] **Step 1: Failing policy tests; Step 2: implement; Step 3: verify** (`npm test`, tools unittest, `arch_policy --base main`, `git_policy --base main`, `docs_policy`, Woodpecker pipeline test); **Step 4: commits** `build(tools): enforce the vendor admin import boundary`, `ci(ci): build and test the vendor admin app`, `build(deploy): add the vendor admin image and edge config`, `docs(docs): document running the vendor admin app`.

---

### Task 11: Live local proof against the real control plane

**Files:**
- Create: `apps/vendor-admin/e2e/live-control.spec.ts`, `tools/vendor_admin_local_check.mjs` (starts/stops the pieces below on scratch ports and databases; prints a pass/fail table; no secrets in output)
- No product changes unless the proof finds a defect (fix it in the owning task's files and say so).

- [ ] **Step 1:** Create a scratch control database `nasq_control_scratch_p3live`; start the real control plane (`npm -w apps/control-plane run dev`) on `127.0.0.1:4179`-free port (pick `4711`) with env: `CONTROL_DATABASE_URL`, `CONTROL_INSTALLATION_ID=vendor-live`, `CONTROL_SERVICE_KEY` (random ≥32 bytes generated per run), `ADMIN_SECRET_KEY` (random, distinct), `ADMIN_RP_ID=localhost`, `ADMIN_ORIGIN=http://localhost:3103`, a minimal inventory/state/repository config as the control-plane tests use (`NASQ_CLI_INVENTORY`, `NASQ_CLI_STATE_DIR`, `NASQ_REPOSITORY_ROOT`).
- [ ] **Step 2:** `npm -w apps/control-plane run admin -- bootstrap-owner owner@example.test "Live Owner" "live proof"` → capture the printed link. Start vendor-admin (`npx nuxt build` output) on 3103 with `NUXT_CONTROL_URL=http://127.0.0.1:4711`, matching key/installation id, `NUXT_ADMIN_ORIGIN=http://localhost:3103`.
- [ ] **Step 3: Playwright live spec** with a virtual authenticator and the **real** control plane (real WebAuthn verification): open the link → enroll passkey + password + TOTP (compute the code in the test with the same RFC 6238 routine from the setup key; import `totpAt` from the control plane's `admin-auth/totp.ts` via a relative path inside the test only) → recovery codes shown → land in the app; sign out; sign in with the passkey; open Team → invite `finance@example.test` (step-up appears when stale; assert it was needed after waiting past the window by setting the DB `step_up_at` back — direct SQL on the scratch DB is allowed here) → open the invite link in a fresh context and enroll; owner disables that account → its session gets 401 on the next request; password+TOTP sign-in works for the owner and the same TOTP code is refused the second time; 6 wrong sign-ins → rate-limit message; `GET /api/vendor/v1/context` returns the owner's capabilities; customers page loads (empty list is fine).
- [ ] **Step 4:** Tear everything down, drop the scratch DB, write the evidence (commands, counts, screenshots viewed) to the report. If the live run cannot be made to work within the task, report exactly what failed and mark phase 3 **not proven live**; do not weaken the mock tests to compensate.
- [ ] **Step 5: Commit** `test(cp): prove vendor admin sign-in against the real control plane`.

## After the last task

- Final whole-branch review on the most capable model, given: the spec, this plan, the ledger, the five Review Focus items, the phase 1 final-review checklist (`.superpowers/sdd/2026-10-15-vendor-admin-p1-ui-layer/progress.md` "Final review" lines) and the phase 2 deferred carry items (BFF `x-nasq-client-ip` overwrite; IP-before-account reservation order in `attempts.ts`; no passkey-add route for password+TOTP sessions — decide: add `POST /v1/admin/auth/passkey/add` guarded by a fresh password re-check, or keep CLI-only recovery and record the decision).
- Phases 2, 1 and 3 merge together into `main` only with the owner's authorization, after `odoo-reviewer` has reviewed the contracts/control-plane parts (`AGENTS.md` merge rules); phase 4 follows.

## Parallel execution schedule (owner request 2026-10-16: launch many agents in parallel)

Every agent works in its own worktree and branch cut from `codex/cp-vendor-admin-app` (`codex/cp-vadm-<slice>`), owns its files exclusively, and the controller merges the slice branches back into `codex/cp-vendor-admin-app` between waves (resolving conflicts, re-running the wave's checks). Implementers use `sonnet`; each slice still gets its own reviewer before merging.

| Wave | Slices run in parallel | File ownership (no overlap) |
|---|---|---|
| 0 | Task 1 (setup, one agent) | docs only |
| 1 | **A** Task 2 · **B** Tasks 3+4 · **C** Task 10A | A: `packages/commercial-ui`, `apps/web` importers, `tools/{ui_policy,ui_catalog,no_external_refs,ui_templates,check_fast}` · B: `apps/vendor-admin` except README/Dockerfile · C: `tools/arch_policy.py`+tests, `.woodpecker.yml`, `deploy/**`, vendor-admin Dockerfile/README, docs, acceptance specs |
| 2 | **D** Task 5 · **E** Task 6 · **F** Task 7 | D: auth pages/composables/middleware/mock/`adminAuth.json`/`useAdminApi.ts` edits · E: layout, `AdminHeader`, `AdminMobileNav`, `adminNav` · F: moved pages/components/composables/utils/`vendor.json`/moved e2e (does not edit `useAdminApi.ts`) |
| 3 | **G** Task 8 · **H** Task 9 · **I** Task 10B | G: `pages/team`, team components · H: `apps/web/**` removal + `tools/arch_baseline.json` via `--write-baseline` only · I: the five scan-root tool files |
| 4 | Task 11 (live proof, one agent) then the final whole-branch review | — |

Waves are sequential (each needs the previous merged); slices inside a wave never share a file. If a slice finds it needs a file another slice owns, it stops and reports instead of editing it.
