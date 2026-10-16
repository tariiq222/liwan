# Phase 2 — Control-plane vendor identity and roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The control plane owns vendor accounts, passkey/password+TOTP/recovery sign-in, sessions with step-up, and six named roles, and authorizes every vendor request from a session instead of an Odoo user id.

**Architecture:** A new `src/admin-auth/` module in `apps/control-plane` holds accounts, credentials, sessions and roles in new `nasq_control` tables. `vendor_memberships` stays as the derived capability table that the workers already re-check, written only by the account service. `authorize()` in `http.ts` resolves the actor from the `x-nasq-session` header, keeps the existing service signature and nonce checks, and enforces step-up for sensitive capabilities.

**Tech Stack:** Node 22, TypeScript, `pg`, `zod`, `vitest 4.1.11`, `@simplewebauthn/server@14.0.3`, `@node-rs/argon2@2.2.1`, `node:crypto` (HMAC-SHA1 TOTP, AES-256-GCM, SHA-256).

**Spec:** [`docs/superpowers/specs/2026-10-15-nasq-vendor-admin-separation-design.md`](../specs/2026-10-15-nasq-vendor-admin-separation-design.md) · master plan [`2026-10-15-vendor-admin-separation-master.md`](2026-10-15-vendor-admin-separation-master.md)

## Global Constraints

- Branch `codex/cp-vendor-identity` in worktree `.worktrees/cp-vendor-identity`; start only after `codex/cp-saas-admin-roles` is merged; merge current `main` before review.
- Commit subjects `type(cp): imperative subject`, at most 72 characters, one logical change per commit, ending with the session's `Co-Authored-By` line.
- Dependencies pinned exactly: `@simplewebauthn/server` `14.0.3`, `@node-rs/argon2` `2.2.1`. Install with `npm ci --ignore-scripts` after adding them with `npm install --ignore-scripts --save-exact -w apps/control-plane`.
- DB tests: `CONTROL_TEST_DATABASE_URL=postgres://127.0.0.1/nasq_control_scratch_<suffix>`; never `nasq_control_dev` or `odoo19`.
- Session: 256-bit token, hash stored only, idle timeout 30 minutes, absolute lifetime 12 hours.
- Step-up window 5 minutes, required for `vendor.pricing.manage`, `vendor.billing.manage`, `vendor.operations.run`, `vendor.accounts.manage`, and catalog publication.
- Invitation link single-use, valid 24 hours. Ten recovery codes, single-use, stored hashed.
- Sign-in failures: one generic `{ code: 'auth_failed' }` with HTTP 401; lockout `{ code: 'rate_limited' }` with HTTP 429.
- `ADMIN_SECRET_KEY` (TOTP encryption) at least 32 bytes and distinct from `CONTROL_SERVICE_KEY`, `CUSTOMER_COMMERCIAL_SERVICE_KEY` and `INTERNAL_EFFECT_KEY`.
- Roles are code constants; no role editing from HTTP. At least one active owner always.
- Audit every authentication and account event in the existing `audit_events` table.
- The schema file number is the next free one when the phase starts; this plan writes `schema_022.sql` and the implementer renames it (and every reference) if `022` is taken.

## Review Focus

1. Two owners demote or disable each other at the same moment → exactly one request wins and one active owner remains (owner rows locked `FOR UPDATE` in one transaction). Test in Task 5.
2. The same email typed with different case or surrounding spaces (`Admin@Nasq.sa `) → one account; invitation and sign-in match it. Test in Task 6.
3. A TOTP code reused inside its 30-second window → second use fails. Test in Task 4 and Task 10.
4. One invitation link opened twice in parallel → only one enrollment succeeds. Test in Task 6.
5. A malformed cookie value, a cookie whose account id differs from the signed actor, or a session of a disabled account → `401` before any route runs. Test in Task 11.

---

### Task 1: Contracts — `vendor.accounts.manage` and anonymous service signing

**Files:**
- Modify: `packages/commercial-contracts/src/index.ts:3`
- Modify: `packages/commercial-contracts/src/server.ts:3-60`
- Test: `packages/commercial-contracts/src/__tests__/contracts.test.ts`

**Interfaces:**
- Produces: `vendorCapabilitySchema` includes `'vendor.accounts.manage'`; `signServiceRequest(input & { anonymous?: true })` accepts `actor: 'anonymous'` only when `anonymous: true`; `verifyServiceRequest(input & { anonymous?: true })` returns `{ actor: 'anonymous', issuer, nonce, timestamp }` for such requests and `null` for anonymous requests verified without `anonymous: true`.

- [ ] **Step 1: Write the failing tests** (append to `contracts.test.ts`)

```ts
import { signServiceRequest, verifyServiceRequest } from '../server.js'
import { vendorCapabilitySchema } from '../index.js'

const key = 'k'.repeat(40)
describe('anonymous service requests', () => {
  it('signs and verifies an anonymous request only when asked to', () => {
    const headers = signServiceRequest({ method: 'POST', path: '/v1/admin/auth/passkey/options', body: '{}', actor: 'anonymous', anonymous: true, issuer: 'vendor-a', key })
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/admin/auth/passkey/options', body: '{}', key, headers, anonymous: true })).toMatchObject({ actor: 'anonymous', issuer: 'vendor-a' })
    expect(verifyServiceRequest({ method: 'POST', path: '/v1/admin/auth/passkey/options', body: '{}', key, headers })).toBeNull()
  })
  it('refuses anonymous actor without the flag', () => {
    expect(() => signServiceRequest({ method: 'GET', path: '/v1/context', actor: 'anonymous', issuer: 'vendor-a', key })).toThrow()
  })
  it('does not accept a numeric actor in anonymous mode', () => {
    const headers = signServiceRequest({ method: 'GET', path: '/v1/context', actor: 7, issuer: 'vendor-a', key })
    expect(verifyServiceRequest({ method: 'GET', path: '/v1/context', key, headers, anonymous: true })).toBeNull()
  })
  it('knows the accounts capability', () => {
    expect(vendorCapabilitySchema.parse('vendor.accounts.manage')).toBe('vendor.accounts.manage')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w packages/commercial-contracts test -- contracts`
Expected: FAIL (`anonymous` unknown, capability rejected).

- [ ] **Step 3: Implement**

In `index.ts` line 3 add `'vendor.accounts.manage'` as the last enum member.

In `server.ts`: add `anonymous?: true` to `ServiceSignInput`; in `signServiceRequest` replace the actor check with

```ts
  const anonymous = input.anonymous === true
  if (anonymous ? input.actor !== 'anonymous' : !/^[1-9][0-9]*$/.test(String(input.actor))) throw new Error('actor must be a positive account ID')
```

and in `verifyServiceRequest` replace the actor regex part and number conversion with

```ts
  const anonymous = input.anonymous === true
  if (!issuer || !/^[a-zA-Z0-9._-]{1,128}$/.test(issuer) || (anonymous ? actorText !== 'anonymous' : !/^[1-9][0-9]*$/.test(actorText)) || !/^\d{10,}$/.test(timestampText) || !nonce || !/^[a-zA-Z0-9._-]{1,128}$/.test(nonce) || !received || !/^[a-f0-9]{64}$/.test(received)) return null
  const actor = anonymous ? 'anonymous' : Number(actorText)
  const timestamp = Number(timestampText)
  if ((!anonymous && !Number.isSafeInteger(actor)) || !Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 30) return null
```

Change the return type to `{ actor: number | 'anonymous'; ... } | null`. `signature()` already stringifies the actor, so the HMAC input is unchanged for numeric actors.

- [ ] **Step 4: Run tests**

Run: `npm -w packages/commercial-contracts test && npm -w apps/control-plane run build`
Expected: PASS; control-plane type check passes (fix any caller that assumed `actor: number` by narrowing with `typeof signed.actor === 'number'`).

- [ ] **Step 5: Commit**

```bash
git add packages/commercial-contracts/src
git commit -m "feat(cp): add accounts capability and anonymous service signing"
```

---

### Task 2: Admin configuration and key separation

**Files:**
- Modify: `apps/control-plane/src/config.ts`
- Test: `apps/control-plane/src/__tests__/config-admin.test.ts` (create)

**Interfaces:**
- Produces: `Config['admin']: { secretKey: Buffer; rpId: string; origin: string; rpName: 'Nasq' }`, read from `ADMIN_SECRET_KEY`, `ADMIN_RP_ID`, `ADMIN_ORIGIN`. Absent `ADMIN_SECRET_KEY` → `admin` undefined and every `/v1/admin/*` route answers `503 { code: 'admin_unavailable' }` (Task 10).

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { adminConfig } from '../config.js'

const base = { CONTROL_SERVICE_KEY: 'c'.repeat(40) }
describe('adminConfig', () => {
  afterEach(() => { delete process.env.ADMIN_SECRET_KEY })
  it('is off without a secret', () => { expect(adminConfig({ ...base })).toBeUndefined() })
  it('requires 32 bytes and distinct keys', () => {
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'short', ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/ADMIN_SECRET_KEY/)
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'c'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/distinct/)
    expect(() => adminConfig({ ...base, INTERNAL_EFFECT_KEY: 'i'.repeat(40), ADMIN_SECRET_KEY: 'i'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://admin.nasq.sa' })).toThrow(/distinct/)
  })
  it('binds origin to the relying party id', () => {
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'https://evil.example' })).toThrow(/ADMIN_ORIGIN/)
    expect(() => adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'admin.nasq.sa', ADMIN_ORIGIN: 'http://admin.nasq.sa' })).toThrow(/ADMIN_ORIGIN/)
    expect(adminConfig({ ...base, ADMIN_SECRET_KEY: 'a'.repeat(40), ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: 'http://localhost:3100' })).toMatchObject({ rpId: 'localhost', origin: 'http://localhost:3100' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- config-admin`
Expected: FAIL (`adminConfig` not exported).

- [ ] **Step 3: Implement** (in `config.ts`, and call it from `getConfig()` as `admin: adminConfig(process.env)`, adding `admin?: AdminConfig` to `Config`)

```ts
export type AdminConfig = { secretKey: Buffer; rpId: string; origin: string; rpName: 'Nasq' }
export function adminConfig(env: Record<string, string | undefined>): AdminConfig | undefined {
  const secret = env.ADMIN_SECRET_KEY
  if (!secret) return undefined
  if (Buffer.byteLength(secret) < 32) throw new Error('ADMIN_SECRET_KEY must contain at least 32 bytes')
  for (const other of [env.CONTROL_SERVICE_KEY, env.CUSTOMER_COMMERCIAL_SERVICE_KEY, env.INTERNAL_EFFECT_KEY]) if (other && other === secret) throw new Error('ADMIN_SECRET_KEY must be distinct from every service key')
  const rpId = env.ADMIN_RP_ID ?? ''
  if (!/^[a-z0-9.-]{1,253}$/.test(rpId)) throw new Error('ADMIN_RP_ID is required')
  let origin: URL
  try { origin = new URL(env.ADMIN_ORIGIN ?? '') } catch { throw new Error('ADMIN_ORIGIN is required') }
  const loopback = rpId === 'localhost' && origin.hostname === 'localhost'
  if (origin.hostname !== rpId || (origin.protocol !== 'https:' && !(loopback && origin.protocol === 'http:')) || origin.pathname !== '/' || origin.search) throw new Error('ADMIN_ORIGIN must be the https origin of ADMIN_RP_ID')
  return { secretKey: Buffer.from(secret), rpId, origin: origin.origin, rpName: 'Nasq' }
}
```

Use the real env variable name of the control service key from `getConfig()` (read `config.ts` lines 1-30; replace `CONTROL_SERVICE_KEY` in code and test if it differs).

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- config-admin && npm -w apps/control-plane run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/config.ts apps/control-plane/src/__tests__/config-admin.test.ts
git commit -m "feat(cp): read vendor admin settings with distinct secret"
```

---

### Task 3: Schema for vendor identity

**Files:**
- Create: `apps/control-plane/src/schema_022.sql`
- Modify: `apps/control-plane/src/db.ts:23-135` (read the file, append `[22, sql22]` to the loop)
- Test: `apps/control-plane/src/__tests__/admin-schema.test.ts` (create, DB-gated)

**Interfaces:**
- Produces tables used by Tasks 5-12 exactly as below.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool } from 'pg'
import { migrate } from '../db.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
if (!url) describe.skip('admin schema (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('admin schema', () => {
  const pool = new Pool({ connectionString: url })
  beforeAll(async () => { await migrate(pool); await migrate(pool) })
  afterAll(async () => { await pool.end() })
  it('creates every identity table once', async () => {
    const rows = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'vendor_%' ORDER BY 1")
    expect(rows.rows.map((r) => r.table_name)).toEqual(['vendor_account_roles','vendor_accounts','vendor_auth_attempts','vendor_auth_challenges','vendor_invitations','vendor_memberships','vendor_passkeys','vendor_recovery_codes','vendor_sessions','vendor_totp'])
  })
  it('stores emails case-insensitively unique', async () => {
    await pool.query("TRUNCATE vendor_accounts CASCADE")
    await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('a@nasq.sa','A')")
    await expect(pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('A@NASQ.SA','B')")).rejects.toThrow()
  })
  it('rejects unknown role keys', async () => {
    const a = await pool.query("INSERT INTO vendor_accounts(email,display_name) VALUES('r@nasq.sa','R') RETURNING id")
    await expect(pool.query("INSERT INTO vendor_account_roles(account_id,role) VALUES($1,'god')", [a.rows[0].id])).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `CONTROL_TEST_DATABASE_URL=postgres://127.0.0.1/nasq_control_scratch_p2 npm -w apps/control-plane test -- admin-schema` (create the database first with `createdb nasq_control_scratch_p2`)
Expected: FAIL (tables missing).

- [ ] **Step 3: Write `schema_022.sql`**

```sql
CREATE TABLE vendor_accounts (
  id bigserial PRIMARY KEY,
  email text NOT NULL CHECK (email = lower(btrim(email)) AND email ~ '^[^@\s]+@[^@\s]+$' AND length(email) <= 254),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  status text NOT NULL DEFAULT 'enrolling' CHECK (status IN ('enrolling','active','disabled')),
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);
CREATE UNIQUE INDEX vendor_accounts_email ON vendor_accounts (email);
CREATE TABLE vendor_account_roles (
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','customer_success','finance','product','operations','support')),
  PRIMARY KEY (account_id, role)
);
CREATE TABLE vendor_passkeys (
  credential_id text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  public_key bytea NOT NULL,
  counter bigint NOT NULL DEFAULT 0,
  transports text[] NOT NULL DEFAULT '{}',
  label text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE TABLE vendor_totp (
  account_id bigint PRIMARY KEY REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  secret_box bytea NOT NULL,
  last_step bigint NOT NULL DEFAULT 0,
  confirmed_at timestamptz
);
CREATE TABLE vendor_recovery_codes (
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  used_at timestamptz,
  PRIMARY KEY (account_id, code_hash)
);
CREATE TABLE vendor_sessions (
  token_hash text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  step_up_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX vendor_sessions_account ON vendor_sessions (account_id) WHERE revoked_at IS NULL;
CREATE TABLE vendor_invitations (
  token_hash text PRIMARY KEY,
  account_id bigint NOT NULL REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('enroll','reset')),
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE vendor_auth_challenges (
  id uuid PRIMARY KEY,
  account_id bigint REFERENCES vendor_accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('register','login','step_up')),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE vendor_auth_attempts (
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  PRIMARY KEY (scope)
);
```

In `db.ts` read it as `const sql22 = await readFile(new URL('./schema_022.sql', import.meta.url), 'utf8')` next to `sql21`, and extend the loop array with `[22, sql22]`.

- [ ] **Step 4: Run tests**

Run: same command as Step 2.
Expected: PASS; second `migrate()` is a no-op.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/schema_022.sql apps/control-plane/src/db.ts apps/control-plane/src/__tests__/admin-schema.test.ts
git commit -m "feat(cp): add vendor identity tables"
```

---

### Task 4: Credential primitives — tokens, secret box, recovery codes, TOTP, passwords

**Files:**
- Create: `apps/control-plane/src/admin-auth/crypto.ts`
- Create: `apps/control-plane/src/admin-auth/totp.ts`
- Create: `apps/control-plane/src/admin-auth/passwords.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/primitives.test.ts`
- Modify: `apps/control-plane/package.json` (add `@node-rs/argon2` `2.2.1` exact)

**Interfaces:**
- Produces:
  - `newToken(): string` (43-char base64url of 32 random bytes); `hashToken(token: string): string` (hex SHA-256)
  - `seal(key: Buffer, plain: Buffer): Buffer` / `open(key: Buffer, box: Buffer): Buffer` (AES-256-GCM, key = SHA-256 of `key`, layout `iv(12)|tag(16)|ciphertext`)
  - `newRecoveryCodes(): string[]` (10 codes `xxxx-xxxx-xxxx`, base32 lowercase)
  - `newTotpSecret(): Buffer` (20 bytes); `totpUri(secret: Buffer, email: string): string`; `totpStep(nowMs: number): number`; `checkTotp(secret: Buffer, code: string, nowMs: number, lastStep: number): number | null` (returns the matched step, accepting steps `now-1..now+1` that are greater than `lastStep`)
  - `hashPassword(p: string): Promise<string>`; `verifyPassword(hash: string, p: string): Promise<boolean>`; `passwordAcceptable(p: string): boolean` (12-256 chars)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { hashToken, newRecoveryCodes, newToken, open, seal } from '../crypto.js'
import { checkTotp, totpAt, totpStep } from '../totp.js'
import { hashPassword, passwordAcceptable, verifyPassword } from '../passwords.js'

describe('tokens and boxes', () => {
  it('makes unique 256-bit tokens and stable hashes', () => {
    const a = newToken(); const b = newToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b)
    expect(hashToken(a)).toBe(hashToken(a)); expect(hashToken(a)).toMatch(/^[a-f0-9]{64}$/)
  })
  it('seals and refuses tampering', () => {
    const key = Buffer.alloc(32, 7)
    const box = seal(key, Buffer.from('secret'))
    expect(open(key, box).toString()).toBe('secret')
    box[box.length - 1] ^= 1
    expect(() => open(key, box)).toThrow()
    expect(() => open(Buffer.alloc(32, 8), seal(key, Buffer.from('x')))).toThrow()
  })
  it('makes ten distinct recovery codes', () => {
    const codes = newRecoveryCodes()
    expect(codes).toHaveLength(10); expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/)
  })
})

describe('TOTP (RFC 6238 SHA-1 vectors, 8 digits)', () => {
  const secret = Buffer.from('12345678901234567890')
  it.each([[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']])('t=%i', (t, code) => {
    expect(totpAt(secret, totpStep(t * 1000), 8)).toBe(code)
  })
  it('accepts a 6-digit code once and refuses replay', () => {
    const now = 1_760_000_000_000
    const code = totpAt(secret, totpStep(now), 6)
    const step = checkTotp(secret, code, now, 0)
    expect(step).toBe(totpStep(now))
    expect(checkTotp(secret, code, now, step!)).toBeNull()
    expect(checkTotp(secret, '000000', now, 0)).toBeNull()
    expect(checkTotp(secret, totpAt(secret, totpStep(now) - 2, 6), now, 0)).toBeNull()
  })
})

describe('passwords', () => {
  it('hashes with argon2id and verifies', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h.startsWith('$argon2id$')).toBe(true)
    expect(await verifyPassword(h, 'correct horse battery')).toBe(true)
    expect(await verifyPassword(h, 'wrong horse battery')).toBe(false)
  })
  it('enforces length', () => {
    expect(passwordAcceptable('short')).toBe(false)
    expect(passwordAcceptable('a'.repeat(12))).toBe(true)
    expect(passwordAcceptable('a'.repeat(257))).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- primitives`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement**

`crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const newToken = (): string => randomBytes(32).toString('base64url')
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')
const boxKey = (key: Buffer) => createHash('sha256').update(key).digest()
export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(key), iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body])
}
export function open(key: Buffer, box: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', boxKey(key), box.subarray(0, 12))
  decipher.setAuthTag(box.subarray(12, 28))
  return Buffer.concat([decipher.update(box.subarray(28)), decipher.final()])
}
const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
export function base32(bytes: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}
export function newRecoveryCodes(): string[] {
  const codes = new Set<string>()
  while (codes.size < 10) { const raw = base32(randomBytes(8)).slice(0, 12); codes.add(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`) }
  return [...codes]
}
```

`totp.ts`:

```ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { base32 } from './crypto.js'

export const newTotpSecret = (): Buffer => randomBytes(20)
export const totpStep = (nowMs: number): number => Math.floor(nowMs / 1000 / 30)
export function totpAt(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', secret).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits
  return String(code).padStart(digits, '0')
}
export function checkTotp(secret: Buffer, code: string, nowMs: number, lastStep: number): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const now = totpStep(nowMs)
  for (const step of [now - 1, now, now + 1]) {
    if (step <= lastStep) continue
    if (timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(code))) return step
  }
  return null
}
export const totpUri = (secret: Buffer, email: string): string =>
  `otpauth://totp/${encodeURIComponent(`Nasq:${email}`)}?secret=${base32(secret).toUpperCase()}&issuer=Nasq&algorithm=SHA1&digits=6&period=30`
```

`passwords.ts`:

```ts
import { hash, verify, Algorithm } from '@node-rs/argon2'

export const passwordAcceptable = (p: string): boolean => typeof p === 'string' && p.length >= 12 && p.length <= 256
export const hashPassword = (p: string): Promise<string> => hash(p, { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })
export async function verifyPassword(stored: string, p: string): Promise<boolean> {
  try { return await verify(stored, p) } catch { return false }
}
```

If `Algorithm` is not exported by `@node-rs/argon2@2.2.1`, read its `index.d.ts` and use the exported numeric constant for Argon2id; keep the `$argon2id$` assertion.

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- primitives && npm -w apps/control-plane run build`
Expected: PASS (all five RFC vectors).

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/package.json package-lock.json apps/control-plane/src/admin-auth
git commit -m "feat(cp): add vendor credential primitives"
```

---

### Task 5: Roles and the derived membership

**Files:**
- Create: `apps/control-plane/src/admin-auth/roles.ts`
- Create: `apps/control-plane/src/admin-auth/accounts.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/roles.test.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/accounts.live.test.ts` (DB-gated)

**Interfaces:**
- Consumes: tables from Task 3; `vendorCapabilitySchema` from Task 1.
- Produces:
  - `type VendorRole = 'owner' | 'customer_success' | 'finance' | 'product' | 'operations' | 'support'`; `VENDOR_ROLES: readonly VendorRole[]`; `capabilitiesFor(roles: VendorRole[]): VendorCapability[]` (sorted, unique)
  - `normalizeEmail(raw: string): string` (trim, lowercase; throws `AdminAuthError('invalid')` when not `x@y`)
  - `class AdminAuthError extends Error { constructor(public status: 401 | 403 | 409 | 422 | 429, public code: 'auth_failed' | 'forbidden' | 'conflict' | 'invalid' | 'rate_limited' | 'last_owner' | 'step_up_required', message?: string) }`
  - `syncMembership(client: PoolClient, issuer: string, accountId: number): Promise<void>` (upsert `vendor_memberships` row from roles and status)
  - `setRoles(client, issuer, actor: { id: number }, accountId: number, roles: VendorRole[], reason: string): Promise<void>`
  - `disableAccount(client, issuer, actor: { id: number } | 'operator', accountId: number, reason: string): Promise<void>` (status `disabled`, sessions revoked, membership revoked)
  - `audit(client, actor: string, action: string, subject: string, reason: string): Promise<void>` (same insert as `http.ts:audit`)

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from 'vitest'
import { capabilitiesFor, VENDOR_ROLES } from '../roles.js'
import { normalizeEmail } from '../accounts.js'

describe('roles', () => {
  it('maps every role exactly as the spec table', () => {
    expect(VENDOR_ROLES).toEqual(['owner','customer_success','finance','product','operations','support'])
    expect(capabilitiesFor(['customer_success'])).toEqual(['vendor.read','vendor.subscriptions.manage','vendor.tenants.manage'])
    expect(capabilitiesFor(['finance'])).toEqual(['vendor.billing.manage','vendor.read'])
    expect(capabilitiesFor(['product'])).toEqual(['vendor.catalog.manage','vendor.pricing.manage','vendor.read'])
    expect(capabilitiesFor(['operations'])).toEqual(['vendor.operations.run','vendor.read'])
    expect(capabilitiesFor(['support'])).toEqual(['vendor.audit.read','vendor.read'])
    expect(capabilitiesFor(['owner'])).toHaveLength(9)
    expect(capabilitiesFor(['finance','customer_success'])).toEqual(['vendor.billing.manage','vendor.read','vendor.subscriptions.manage','vendor.tenants.manage'])
    expect(capabilitiesFor([])).toEqual([])
  })
  it('normalizes email', () => {
    expect(normalizeEmail('  Admin@Nasq.SA ')).toBe('admin@nasq.sa')
    expect(() => normalizeEmail('nope')).toThrow()
  })
})
```

- [ ] **Step 2: Write the failing DB test** (`accounts.live.test.ts`; same skip guard as Task 3)

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { Pool } from 'pg'
import { migrate, transaction } from '../../db.js'
import { disableAccount, setRoles, syncMembership } from '../accounts.js'

const url = process.env.CONTROL_TEST_DATABASE_URL
const issuer = 'vendor-scratch'
if (!url) describe.skip('accounts (requires CONTROL_TEST_DATABASE_URL)', () => {})
else describe('accounts', () => {
  const pool = new Pool({ connectionString: url })
  let a = 0, b = 0
  beforeEach(async () => {
    await migrate(pool)
    await pool.query('TRUNCATE vendor_accounts, vendor_memberships, audit_events CASCADE')
    a = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('a@nasq.sa','A','active') RETURNING id")).rows[0].id
    b = (await pool.query("INSERT INTO vendor_accounts(email,display_name,status) VALUES('b@nasq.sa','B','active') RETURNING id")).rows[0].id
    await pool.query("INSERT INTO vendor_account_roles VALUES($1,'owner'),($2,'owner')", [a, b])
    await transaction(pool, async (c) => { await syncMembership(c, issuer, a); await syncMembership(c, issuer, b) })
  })
  afterAll(async () => { await pool.end() })

  it('writes the derived membership', async () => {
    await transaction(pool, (c) => setRoles(c, issuer, { id: a }, b, ['finance'], 'move to finance'))
    const row = await pool.query('SELECT capabilities, revoked_at FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2', [issuer, b])
    expect(row.rows[0]).toEqual({ capabilities: ['vendor.billing.manage','vendor.read'], revoked_at: null })
  })
  it('never leaves zero owners, even when two owners demote each other at once', async () => {
    const results = await Promise.allSettled([
      transaction(pool, (c) => setRoles(c, issuer, { id: a }, b, ['support'], 'swap')),
      transaction(pool, (c) => setRoles(c, issuer, { id: b }, a, ['support'], 'swap')),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const owners = await pool.query("SELECT count(*)::int AS n FROM vendor_account_roles r JOIN vendor_accounts x ON x.id=r.account_id WHERE r.role='owner' AND x.status='active'")
    expect(owners.rows[0].n).toBe(1)
  })
  it('refuses to disable the last owner and revokes sessions of a disabled account', async () => {
    await transaction(pool, (c) => disableAccount(c, issuer, { id: a }, b, 'left the company'))
    await expect(transaction(pool, (c) => disableAccount(c, issuer, 'operator', a, 'mistake'))).rejects.toMatchObject({ code: 'last_owner' })
    const m = await pool.query('SELECT revoked_at FROM vendor_memberships WHERE actor_uid=$1', [b])
    expect(m.rows[0].revoked_at).not.toBeNull()
  })
  it('lets an owner change own roles only while another owner exists', async () => {
    await transaction(pool, (c) => setRoles(c, issuer, { id: a }, a, ['owner','finance'], 'add finance'))
    await transaction(pool, (c) => disableAccount(c, issuer, { id: a }, b, 'left'))
    await expect(transaction(pool, (c) => setRoles(c, issuer, { id: a }, a, ['finance'], 'drop owner'))).rejects.toMatchObject({ code: 'last_owner' })
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npm -w apps/control-plane test -- roles accounts` (with `CONTROL_TEST_DATABASE_URL` set)
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

`roles.ts`:

```ts
import type { VendorCapability } from '@nasq/commercial-contracts'

export const VENDOR_ROLES = ['owner','customer_success','finance','product','operations','support'] as const
export type VendorRole = typeof VENDOR_ROLES[number]
const ROLE_CAPABILITIES: Record<VendorRole, VendorCapability[]> = {
  owner: ['vendor.read','vendor.audit.read','vendor.tenants.manage','vendor.subscriptions.manage','vendor.catalog.manage','vendor.pricing.manage','vendor.billing.manage','vendor.operations.run','vendor.accounts.manage'],
  customer_success: ['vendor.read','vendor.tenants.manage','vendor.subscriptions.manage'],
  finance: ['vendor.read','vendor.billing.manage'],
  product: ['vendor.read','vendor.catalog.manage','vendor.pricing.manage'],
  operations: ['vendor.read','vendor.operations.run'],
  support: ['vendor.read','vendor.audit.read'],
}
export const capabilitiesFor = (roles: readonly VendorRole[]): VendorCapability[] =>
  [...new Set(roles.flatMap((role) => ROLE_CAPABILITIES[role]))].sort()
export const STEP_UP_CAPABILITIES: readonly VendorCapability[] = ['vendor.pricing.manage','vendor.billing.manage','vendor.operations.run','vendor.accounts.manage']
```

`accounts.ts`:

```ts
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { capabilitiesFor, VENDOR_ROLES, type VendorRole } from './roles.js'

export class AdminAuthError extends Error {
  constructor(public status: 401 | 403 | 409 | 422 | 429, public code: 'auth_failed' | 'forbidden' | 'conflict' | 'invalid' | 'rate_limited' | 'last_owner' | 'step_up_required', message = code) { super(message) }
}
export function normalizeEmail(raw: string): string {
  const email = String(raw ?? '').trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 254) throw new AdminAuthError(422, 'invalid')
  return email
}
export async function audit(client: PoolClient, actor: string, action: string, subject: string, reason: string): Promise<void> {
  await client.query('INSERT INTO audit_events(id,actor,action,subject,reason) VALUES($1,$2,$3,$4,$5)', [randomUUID(), actor, action, subject, reason])
}
const actorName = (actor: { id: number } | 'operator') => actor === 'operator' ? 'operator' : `account:${actor.id}`
function requireReason(reason: string): string {
  const text = String(reason ?? '').trim()
  if (text.length < 3 || text.length > 1000) throw new AdminAuthError(422, 'invalid', 'reason of 3-1000 characters required')
  return text
}
async function lockOwners(client: PoolClient): Promise<number[]> {
  const rows = await client.query("SELECT a.id FROM vendor_accounts a JOIN vendor_account_roles r ON r.account_id=a.id AND r.role='owner' WHERE a.status='active' ORDER BY a.id FOR UPDATE OF a")
  return rows.rows.map((r) => Number(r.id))
}
export async function syncMembership(client: PoolClient, issuer: string, accountId: number): Promise<void> {
  const account = await client.query('SELECT status FROM vendor_accounts WHERE id=$1', [accountId])
  if (!account.rowCount) throw new AdminAuthError(422, 'invalid')
  const roles = (await client.query('SELECT role FROM vendor_account_roles WHERE account_id=$1', [accountId])).rows.map((r) => r.role as VendorRole)
  const active = account.rows[0].status === 'active'
  await client.query(`INSERT INTO vendor_memberships(issuer,actor_uid,capabilities,revoked_at) VALUES($1,$2,$3,${active ? 'NULL' : 'now()'})
    ON CONFLICT(issuer,actor_uid) DO UPDATE SET capabilities=EXCLUDED.capabilities, revoked_at=EXCLUDED.revoked_at`, [issuer, accountId, capabilitiesFor(roles)])
}
export async function setRoles(client: PoolClient, issuer: string, actor: { id: number } | 'operator', accountId: number, roles: VendorRole[], reason: string): Promise<void> {
  const why = requireReason(reason)
  if (!roles.length || roles.some((r) => !VENDOR_ROLES.includes(r)) || new Set(roles).size !== roles.length) throw new AdminAuthError(422, 'invalid')
  const owners = await lockOwners(client)
  if (owners.includes(accountId) && !roles.includes('owner') && owners.length <= 1) throw new AdminAuthError(409, 'last_owner')
  if (actor !== 'operator' && actor.id === accountId && owners.filter((id) => id !== accountId).length === 0) throw new AdminAuthError(409, 'last_owner')
  await client.query('DELETE FROM vendor_account_roles WHERE account_id=$1', [accountId])
  for (const role of roles) await client.query('INSERT INTO vendor_account_roles(account_id,role) VALUES($1,$2)', [accountId, role])
  await syncMembership(client, issuer, accountId)
  await audit(client, actorName(actor), 'account.roles_set', `account:${accountId}`, `${why} [${roles.join(',')}]`)
}
export async function disableAccount(client: PoolClient, issuer: string, actor: { id: number } | 'operator', accountId: number, reason: string): Promise<void> {
  const why = requireReason(reason)
  const owners = await lockOwners(client)
  if (owners.includes(accountId) && owners.length <= 1) throw new AdminAuthError(409, 'last_owner')
  const updated = await client.query("UPDATE vendor_accounts SET status='disabled', disabled_at=now() WHERE id=$1 AND status<>'disabled' RETURNING id", [accountId])
  if (!updated.rowCount) throw new AdminAuthError(422, 'invalid')
  await client.query('UPDATE vendor_sessions SET revoked_at=now() WHERE account_id=$1 AND revoked_at IS NULL', [accountId])
  await syncMembership(client, issuer, accountId)
  await audit(client, actorName(actor), 'account.disabled', `account:${accountId}`, why)
}
```

Note: the parallel-demotion test relies on `FOR UPDATE OF a` serializing both transactions on the same owner rows; the second transaction re-reads owners after the first commits and sees one owner, so it fails with `last_owner`.

- [ ] **Step 5: Run tests**

Run: `npm -w apps/control-plane test -- roles accounts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane/src/admin-auth
git commit -m "feat(cp): add vendor roles and derived memberships"
```

---

### Task 6: Invitations and enrollment

**Files:**
- Create: `apps/control-plane/src/admin-auth/enrollment.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/enrollment.live.test.ts` (DB-gated)

**Interfaces:**
- Consumes: Task 4 primitives, Task 5 `AdminAuthError`, `audit`, `normalizeEmail`, `setRoles`, `syncMembership`.
- Produces:
  - `inviteAccount(client, issuer, actor: { id: number } | 'operator', input: { email: string; displayName: string; roles: VendorRole[]; reason: string }, now: Date): Promise<{ token: string; expiresAt: Date }>` — creates an `enrolling` account (or `409 conflict` if the email exists) and an `enroll` invitation
  - `issueReset(client, actor: { id: number } | 'operator', accountId: number, reason: string, now: Date): Promise<{ token: string; expiresAt: Date }>` — `reset` invitation; existing passkeys, TOTP, recovery codes and sessions are deleted when it is consumed
  - `openInvitation(client, token: string, now: Date): Promise<{ accountId: number; purpose: 'enroll' | 'reset'; email: string }>` — locks the invitation row `FOR UPDATE`; throws `401 auth_failed` if unknown, expired or consumed
  - `completeEnrollment(client, issuer, token: string, input: { password: string; totpCode: string; totpSecretBox: Buffer; passkeyRegistered: boolean }, secretKey: Buffer, now: Date): Promise<{ accountId: number; recoveryCodes: string[] }>` — requires a passkey registered for the account during this invitation, a valid password, and a TOTP code for the provisional secret; sets status `active`, stores hashes, consumes the invitation, syncs membership, audits `account.enrolled`

- [ ] **Step 1: Write the failing tests**

```ts
// enrollment.live.test.ts — same guard and pool setup as accounts.live.test.ts
import { totpAt, totpStep, newTotpSecret } from '../totp.js'
import { seal } from '../crypto.js'
import { completeEnrollment, inviteAccount, openInvitation } from '../enrollment.js'

const secretKey = Buffer.alloc(32, 3)
const now = new Date('2026-11-01T10:00:00Z')

it('enrolls once from a normalized email invitation', async () => {
  const { token } = await transaction(pool, (c) => inviteAccount(c, issuer, 'operator', { email: ' Owner@Nasq.SA ', displayName: 'Owner', roles: ['owner'], reason: 'first owner' }, now))
  const opened = await transaction(pool, (c) => openInvitation(c, token, now))
  expect(opened.email).toBe('owner@nasq.sa')
  await pool.query("INSERT INTO vendor_passkeys(credential_id,account_id,public_key) VALUES('cred-1',$1,'\\x00')", [opened.accountId])
  const secret = newTotpSecret()
  const input = { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret), passkeyRegistered: true }
  const [first, second] = await Promise.allSettled([
    transaction(pool, (c) => completeEnrollment(c, issuer, token, input, secretKey, now)),
    transaction(pool, (c) => completeEnrollment(c, issuer, token, input, secretKey, now)),
  ])
  expect([first.status, second.status].sort()).toEqual(['fulfilled', 'rejected'])
  const done = (first.status === 'fulfilled' ? first : second) as PromiseFulfilledResult<{ recoveryCodes: string[] }>
  expect(done.value.recoveryCodes).toHaveLength(10)
  const account = await pool.query('SELECT status FROM vendor_accounts WHERE email=$1', ['owner@nasq.sa'])
  expect(account.rows[0].status).toBe('active')
})
it('refuses a duplicate email in another case', async () => {
  await transaction(pool, (c) => inviteAccount(c, issuer, 'operator', { email: 'x@nasq.sa', displayName: 'X', roles: ['support'], reason: 'support' }, now))
  await expect(transaction(pool, (c) => inviteAccount(c, issuer, 'operator', { email: 'X@NASQ.SA', displayName: 'X2', roles: ['support'], reason: 'support' }, now))).rejects.toMatchObject({ code: 'conflict' })
})
it('rejects an expired invitation and enrollment without passkey', async () => {
  const { token } = await transaction(pool, (c) => inviteAccount(c, issuer, 'operator', { email: 'late@nasq.sa', displayName: 'L', roles: ['support'], reason: 'support' }, now))
  await expect(transaction(pool, (c) => openInvitation(c, token, new Date(now.getTime() + 24 * 3600_000 + 1)))).rejects.toMatchObject({ code: 'auth_failed' })
  const secret = newTotpSecret()
  await expect(transaction(pool, (c) => completeEnrollment(c, issuer, token, { password: 'a long enough password', totpCode: totpAt(secret, totpStep(now.getTime())), totpSecretBox: seal(secretKey, secret), passkeyRegistered: false }, secretKey, now))).rejects.toMatchObject({ code: 'invalid' })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- enrollment`
Expected: FAIL.

- [ ] **Step 3: Implement `enrollment.ts`**

```ts
import type { PoolClient } from 'pg'
import { hashToken, newRecoveryCodes, newToken, open } from './crypto.js'
import { checkTotp } from './totp.js'
import { hashPassword, passwordAcceptable } from './passwords.js'
import { AdminAuthError, audit, normalizeEmail, setRoles, syncMembership } from './accounts.js'
import type { VendorRole } from './roles.js'

const DAY = 24 * 3600_000
const actorName = (actor: { id: number } | 'operator') => actor === 'operator' ? 'operator' : `account:${actor.id}`

export async function inviteAccount(client: PoolClient, issuer: string, actor: { id: number } | 'operator', input: { email: string; displayName: string; roles: VendorRole[]; reason: string }, now: Date) {
  const email = normalizeEmail(input.email)
  const name = String(input.displayName ?? '').trim()
  if (!name || name.length > 120) throw new AdminAuthError(422, 'invalid')
  const inserted = await client.query('INSERT INTO vendor_accounts(email,display_name) VALUES($1,$2) ON CONFLICT (email) DO NOTHING RETURNING id', [email, name])
  if (!inserted.rowCount) throw new AdminAuthError(409, 'conflict')
  const accountId = Number(inserted.rows[0].id)
  await setRoles(client, issuer, 'operator', accountId, input.roles, input.reason)
  const token = newToken(); const expiresAt = new Date(now.getTime() + DAY)
  await client.query("INSERT INTO vendor_invitations(token_hash,account_id,purpose,created_by,expires_at) VALUES($1,$2,'enroll',$3,$4)", [hashToken(token), accountId, actorName(actor), expiresAt])
  await audit(client, actorName(actor), 'account.invited', `account:${accountId}`, input.reason)
  return { token, expiresAt }
}

export async function issueReset(client: PoolClient, actor: { id: number } | 'operator', accountId: number, reason: string, now: Date) {
  const account = await client.query("SELECT id FROM vendor_accounts WHERE id=$1 AND status<>'disabled' FOR UPDATE", [accountId])
  if (!account.rowCount) throw new AdminAuthError(422, 'invalid')
  await client.query('UPDATE vendor_invitations SET consumed_at=now() WHERE account_id=$1 AND consumed_at IS NULL', [accountId])
  const token = newToken(); const expiresAt = new Date(now.getTime() + DAY)
  await client.query("INSERT INTO vendor_invitations(token_hash,account_id,purpose,created_by,expires_at) VALUES($1,$2,'reset',$3,$4)", [hashToken(token), accountId, actorName(actor), expiresAt])
  await audit(client, actorName(actor), 'account.reset_issued', `account:${accountId}`, reason)
  return { token, expiresAt }
}

export async function openInvitation(client: PoolClient, token: string, now: Date) {
  const row = await client.query('SELECT i.account_id, i.purpose, i.expires_at, i.consumed_at, a.email FROM vendor_invitations i JOIN vendor_accounts a ON a.id=i.account_id WHERE i.token_hash=$1 FOR UPDATE OF i', [hashToken(String(token ?? ''))])
  const inv = row.rows[0]
  if (!inv || inv.consumed_at || new Date(inv.expires_at) <= now) throw new AdminAuthError(401, 'auth_failed')
  return { accountId: Number(inv.account_id), purpose: inv.purpose as 'enroll' | 'reset', email: inv.email as string }
}

export async function completeEnrollment(client: PoolClient, issuer: string, token: string, input: { password: string; totpCode: string; totpSecretBox: Buffer; passkeyRegistered: boolean }, secretKey: Buffer, now: Date) {
  const inv = await openInvitation(client, token, now)
  if (!input.passkeyRegistered || !passwordAcceptable(input.password)) throw new AdminAuthError(422, 'invalid')
  const step = checkTotp(open(secretKey, input.totpSecretBox), String(input.totpCode ?? ''), now.getTime(), 0)
  if (step === null) throw new AdminAuthError(422, 'invalid')
  await client.query("UPDATE vendor_accounts SET status='active', password_hash=$2 WHERE id=$1", [inv.accountId, await hashPassword(input.password)])
  await client.query('INSERT INTO vendor_totp(account_id,secret_box,last_step,confirmed_at) VALUES($1,$2,$3,$4) ON CONFLICT (account_id) DO UPDATE SET secret_box=EXCLUDED.secret_box,last_step=EXCLUDED.last_step,confirmed_at=EXCLUDED.confirmed_at', [inv.accountId, input.totpSecretBox, step, now])
  await client.query('DELETE FROM vendor_recovery_codes WHERE account_id=$1', [inv.accountId])
  const recoveryCodes = newRecoveryCodes()
  for (const code of recoveryCodes) await client.query('INSERT INTO vendor_recovery_codes(account_id,code_hash) VALUES($1,$2)', [inv.accountId, hashToken(code)])
  await client.query('UPDATE vendor_invitations SET consumed_at=$2 WHERE token_hash=$1', [hashToken(token), now])
  await syncMembership(client, issuer, inv.accountId)
  await audit(client, `account:${inv.accountId}`, inv.purpose === 'reset' ? 'account.reset_completed' : 'account.enrolled', `account:${inv.accountId}`, inv.purpose)
  return { accountId: inv.accountId, recoveryCodes }
}
```

For a `reset` invitation, the passkey-registration route (Task 10) deletes the account's existing passkeys, TOTP, recovery codes and sessions inside the same transaction that registers the new passkey; `completeEnrollment` then replaces TOTP and codes as above.

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- enrollment`
Expected: PASS (the parallel completion yields one success because `openInvitation` locks the row and the loser sees `consumed_at`).

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/admin-auth
git commit -m "feat(cp): add vendor invitations and enrollment"
```

---

### Task 7: Sessions and step-up

**Files:**
- Create: `apps/control-plane/src/admin-auth/sessions.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/sessions.live.test.ts` (DB-gated)

**Interfaces:**
- Produces:
  - `IDLE_MS = 30 * 60_000`, `ABSOLUTE_MS = 12 * 3600_000`, `STEP_UP_MS = 5 * 60_000`
  - `createSession(client, accountId: number, now: Date, stepUp: boolean): Promise<{ session: string; expiresAt: Date; idleExpiresAt: Date }>` — `session` is `${accountId}.${token}`
  - `parseSession(value: unknown): { accountId: number; token: string } | null`
  - `resolveSession(client, value: unknown, now: Date): Promise<{ accountId: number; tokenHash: string; stepUpFresh: boolean }>` — throws `401 auth_failed` unless the session exists, belongs to the parsed account, is not revoked, `now < expires_at`, `now - last_seen_at < IDLE_MS`, and the account is `active`; updates `last_seen_at`
  - `markStepUp(client, tokenHash: string, now: Date): Promise<void>`
  - `revokeSession(client, tokenHash: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

```ts
import { createSession, parseSession, resolveSession, markStepUp, IDLE_MS, ABSOLUTE_MS, STEP_UP_MS } from '../sessions.js'

it('parses only well-formed values', () => {
  expect(parseSession('12.' + 'a'.repeat(43))).toEqual({ accountId: 12, token: 'a'.repeat(43) })
  for (const bad of [undefined, '', '0.' + 'a'.repeat(43), '12', '12.short', 'x.' + 'a'.repeat(43), ['12.' + 'a'.repeat(43)]]) expect(parseSession(bad)).toBeNull()
})
it('expires on idle and on absolute lifetime', async () => {
  const t0 = new Date('2026-11-01T10:00:00Z')
  const { session } = await transaction(pool, (c) => createSession(c, accountId, t0, false))
  await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + IDLE_MS - 1000)))
  await expect(transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + 2 * IDLE_MS)))).rejects.toMatchObject({ code: 'auth_failed' })
  const s2 = (await transaction(pool, (c) => createSession(c, accountId, t0, false))).session
  let t = t0.getTime()
  while (t + IDLE_MS / 2 < t0.getTime() + ABSOLUTE_MS) { t += IDLE_MS / 2; if (t < t0.getTime() + ABSOLUTE_MS) await transaction(pool, (c) => resolveSession(c, s2, new Date(t))) }
  await expect(transaction(pool, (c) => resolveSession(c, s2, new Date(t0.getTime() + ABSOLUTE_MS)))).rejects.toMatchObject({ code: 'auth_failed' })
})
it('rejects another account id with a valid token', async () => {
  const { session } = await transaction(pool, (c) => createSession(c, accountId, new Date(), false))
  const forged = `${accountId + 1}.${session.split('.')[1]}`
  await expect(transaction(pool, (c) => resolveSession(c, forged, new Date()))).rejects.toMatchObject({ code: 'auth_failed' })
})
it('tracks step-up freshness', async () => {
  const t0 = new Date('2026-11-01T10:00:00Z')
  const { session } = await transaction(pool, (c) => createSession(c, accountId, t0, true))
  expect((await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS - 1000)))).stepUpFresh).toBe(true)
  const late = await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS + 1000)))
  expect(late.stepUpFresh).toBe(false)
  await transaction(pool, (c) => markStepUp(c, late.tokenHash, new Date(t0.getTime() + STEP_UP_MS + 2000)))
  expect((await transaction(pool, (c) => resolveSession(c, session, new Date(t0.getTime() + STEP_UP_MS + 3000)))).stepUpFresh).toBe(true)
})
```

Setup creates one `active` account (`accountId`) in `beforeEach` after truncating `vendor_accounts CASCADE`.

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- sessions`
Expected: FAIL.

- [ ] **Step 3: Implement `sessions.ts`**

```ts
import type { PoolClient } from 'pg'
import { hashToken, newToken } from './crypto.js'
import { AdminAuthError } from './accounts.js'

export const IDLE_MS = 30 * 60_000
export const ABSOLUTE_MS = 12 * 3600_000
export const STEP_UP_MS = 5 * 60_000

export function parseSession(value: unknown): { accountId: number; token: string } | null {
  if (typeof value !== 'string') return null
  const match = /^([1-9][0-9]{0,15})\.([A-Za-z0-9_-]{43})$/.exec(value)
  if (!match) return null
  const accountId = Number(match[1])
  return Number.isSafeInteger(accountId) ? { accountId, token: match[2] } : null
}
export async function createSession(client: PoolClient, accountId: number, now: Date, stepUp: boolean) {
  const token = newToken()
  const expiresAt = new Date(now.getTime() + ABSOLUTE_MS)
  await client.query('INSERT INTO vendor_sessions(token_hash,account_id,created_at,last_seen_at,expires_at,step_up_at) VALUES($1,$2,$3,$3,$4,$5)', [hashToken(token), accountId, now, expiresAt, stepUp ? now : null])
  return { session: `${accountId}.${token}`, expiresAt, idleExpiresAt: new Date(Math.min(now.getTime() + IDLE_MS, expiresAt.getTime())) }
}
export async function resolveSession(client: PoolClient, value: unknown, now: Date) {
  const parsed = parseSession(value)
  if (!parsed) throw new AdminAuthError(401, 'auth_failed')
  const tokenHash = hashToken(parsed.token)
  const row = await client.query(`SELECT s.account_id, s.expires_at, s.last_seen_at, s.step_up_at FROM vendor_sessions s JOIN vendor_accounts a ON a.id=s.account_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND a.status='active' FOR UPDATE OF s`, [tokenHash])
  const s = row.rows[0]
  if (!s || Number(s.account_id) !== parsed.accountId || now >= new Date(s.expires_at) || now.getTime() - new Date(s.last_seen_at).getTime() >= IDLE_MS) throw new AdminAuthError(401, 'auth_failed')
  await client.query('UPDATE vendor_sessions SET last_seen_at=$2 WHERE token_hash=$1', [tokenHash, now])
  return { accountId: parsed.accountId, tokenHash, stepUpFresh: Boolean(s.step_up_at) && now.getTime() - new Date(s.step_up_at).getTime() < STEP_UP_MS }
}
export async function markStepUp(client: PoolClient, tokenHash: string, now: Date) {
  await client.query('UPDATE vendor_sessions SET step_up_at=$2 WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash, now])
}
export async function revokeSession(client: PoolClient, tokenHash: string) {
  await client.query('UPDATE vendor_sessions SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL', [tokenHash])
}
```

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/admin-auth
git commit -m "feat(cp): add vendor sessions with idle, absolute and step-up limits"
```

---

### Task 8: Attempt limits and lockout

**Files:**
- Create: `apps/control-plane/src/admin-auth/attempts.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/attempts.live.test.ts` (DB-gated)

**Interfaces:**
- Produces:
  - `checkAllowed(client, scopes: string[], now: Date): Promise<void>` — throws `429 rate_limited` if any scope is locked
  - `recordFailure(client, scopes: string[], now: Date): Promise<void>` — per scope, 15-minute window; 5 failures for `account:*`, 20 for `ip:*` lock the scope for 15 minutes
  - `recordSuccess(client, scopes: string[]): Promise<void>` — deletes the `account:*` scopes only
  - Scope strings: `account:<email>` and `ip:<remote address>`

- [ ] **Step 1: Write the failing tests**

```ts
import { checkAllowed, recordFailure, recordSuccess } from '../attempts.js'
const t0 = new Date('2026-11-01T10:00:00Z')
it('locks an account after five failures for fifteen minutes', async () => {
  for (let i = 0; i < 5; i++) await transaction(pool, (c) => recordFailure(c, ['account:a@nasq.sa', 'ip:1.1.1.1'], t0))
  await expect(transaction(pool, (c) => checkAllowed(c, ['account:a@nasq.sa'], t0))).rejects.toMatchObject({ code: 'rate_limited' })
  await transaction(pool, (c) => checkAllowed(c, ['ip:1.1.1.1'], t0))
  await transaction(pool, (c) => checkAllowed(c, ['account:a@nasq.sa'], new Date(t0.getTime() + 15 * 60_000 + 1)))
})
it('resets the account count on success but keeps the ip count', async () => {
  for (let i = 0; i < 4; i++) await transaction(pool, (c) => recordFailure(c, ['account:b@nasq.sa', 'ip:2.2.2.2'], t0))
  await transaction(pool, (c) => recordSuccess(c, ['account:b@nasq.sa', 'ip:2.2.2.2']))
  await transaction(pool, (c) => recordFailure(c, ['account:b@nasq.sa'], t0))
  await transaction(pool, (c) => checkAllowed(c, ['account:b@nasq.sa'], t0))
  const ip = await pool.query("SELECT failures FROM vendor_auth_attempts WHERE scope='ip:2.2.2.2'")
  expect(ip.rows[0].failures).toBe(4)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- attempts`
Expected: FAIL.

- [ ] **Step 3: Implement `attempts.ts`**

```ts
import type { PoolClient } from 'pg'
import { AdminAuthError } from './accounts.js'

const WINDOW_MS = 15 * 60_000
const limitFor = (scope: string) => scope.startsWith('account:') ? 5 : 20
export async function checkAllowed(client: PoolClient, scopes: string[], now: Date) {
  const rows = await client.query('SELECT 1 FROM vendor_auth_attempts WHERE scope = ANY($1) AND locked_until > $2', [scopes, now])
  if (rows.rowCount) throw new AdminAuthError(429, 'rate_limited')
}
export async function recordFailure(client: PoolClient, scopes: string[], now: Date) {
  for (const scope of scopes) {
    await client.query(`INSERT INTO vendor_auth_attempts(scope,window_start,failures) VALUES($1,$2,1)
      ON CONFLICT (scope) DO UPDATE SET
        failures = CASE WHEN vendor_auth_attempts.window_start <= $2 - interval '15 minutes' THEN 1 ELSE vendor_auth_attempts.failures + 1 END,
        window_start = CASE WHEN vendor_auth_attempts.window_start <= $2 - interval '15 minutes' THEN $2 ELSE vendor_auth_attempts.window_start END`, [scope, now])
    await client.query('UPDATE vendor_auth_attempts SET locked_until=$3 WHERE scope=$1 AND failures >= $2', [scope, limitFor(scope), new Date(now.getTime() + WINDOW_MS)])
  }
}
export async function recordSuccess(client: PoolClient, scopes: string[]) {
  await client.query("DELETE FROM vendor_auth_attempts WHERE scope = ANY($1) AND scope LIKE 'account:%'", [scopes])
}
```

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- attempts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/admin-auth
git commit -m "feat(cp): limit vendor sign-in attempts"
```

---

### Task 9: WebAuthn wrapper and challenge store

**Files:**
- Create: `apps/control-plane/src/admin-auth/webauthn.ts`
- Test: `apps/control-plane/src/admin-auth/__tests__/webauthn.live.test.ts` (DB-gated)
- Modify: `apps/control-plane/package.json` (add `@simplewebauthn/server` `14.0.3` exact)

**Interfaces:**
- Consumes: `AdminConfig` (Task 2).
- Produces (the only file that imports `@simplewebauthn/server`):
  - `type WebAuthnLib = { generateRegistrationOptions; verifyRegistrationResponse; generateAuthenticationOptions; verifyAuthenticationResponse }` (the four library functions; injected so tests can stub them)
  - `registrationOptions(client, lib, admin: AdminConfig, account: { id: number; email: string; displayName: string }, now: Date): Promise<{ challengeId: string; options: unknown }>`
  - `finishRegistration(client, lib, admin, accountId: number, challengeId: string, response: unknown, label: string, now: Date): Promise<void>` — stores credential id, public key, counter, transports
  - `authenticationOptions(client, lib, admin, kind: 'login' | 'step_up', accountId: number | null, now: Date): Promise<{ challengeId: string; options: unknown }>` — `login` uses discoverable credentials (no `allowCredentials`); `step_up` lists the account's credentials
  - `finishAuthentication(client, lib, admin, kind: 'login' | 'step_up', challengeId: string, response: unknown, now: Date): Promise<{ accountId: number }>` — finds the credential by `response.id`, verifies with `requireUserVerification: true`, expected origin and RP id from `admin`, checks the counter, updates `counter` and `last_used_at`; for `step_up` the credential must belong to the challenge's account
  - Challenges: single use (deleted on finish), expire after 5 minutes; any failure throws `401 auth_failed`

- [ ] **Step 1: Read the library types**

Run: `sed -n 1,200p node_modules/@simplewebauthn/server/esm/index.d.ts` (path may differ; use `find node_modules/@simplewebauthn/server -name 'index.d.ts'`). Record the v14 option and result field names (registration info credential fields, `expectedChallenge`, `credential` input of `verifyAuthenticationResponse`) in a comment at the top of `webauthn.ts`. Use those exact names below; the stubs in tests must return the same shapes.

- [ ] **Step 2: Write the failing tests** (stubbed library)

```ts
import { authenticationOptions, finishAuthentication, finishRegistration, registrationOptions, type WebAuthnLib } from '../webauthn.js'
const admin = { secretKey: Buffer.alloc(32), rpId: 'localhost', origin: 'http://localhost:3100', rpName: 'Nasq' as const }
const now = new Date('2026-11-01T10:00:00Z')
function lib(overrides: Partial<WebAuthnLib> = {}): WebAuthnLib {
  return {
    generateRegistrationOptions: async () => ({ challenge: 'reg-challenge' }),
    verifyRegistrationResponse: async () => ({ verified: true, registrationInfo: { credential: { id: 'cred-1', publicKey: new Uint8Array([1, 2]), counter: 0, transports: ['internal'] } } }),
    generateAuthenticationOptions: async () => ({ challenge: 'auth-challenge' }),
    verifyAuthenticationResponse: async () => ({ verified: true, authenticationInfo: { newCounter: 1 } }),
    ...overrides,
  } as unknown as WebAuthnLib
}
it('registers and then signs in with a discoverable passkey, once per challenge', async () => {
  const reg = await transaction(pool, (c) => registrationOptions(c, lib(), admin, { id: accountId, email: 'a@nasq.sa', displayName: 'A' }, now))
  await transaction(pool, (c) => finishRegistration(c, lib(), admin, accountId, reg.challengeId, { id: 'cred-1' }, 'Laptop', now))
  const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
  expect(await transaction(pool, (c) => finishAuthentication(c, lib(), admin, 'login', auth.challengeId, { id: 'cred-1' }, now))).toEqual({ accountId })
  await expect(transaction(pool, (c) => finishAuthentication(c, lib(), admin, 'login', auth.challengeId, { id: 'cred-1' }, now))).rejects.toMatchObject({ code: 'auth_failed' })
})
it('fails closed on verification failure, expiry and foreign step-up credentials', async () => {
  const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
  await expect(transaction(pool, (c) => finishAuthentication(c, lib({ verifyAuthenticationResponse: async () => ({ verified: false }) } as never), admin, 'login', auth.challengeId, { id: 'cred-1' }, now))).rejects.toMatchObject({ code: 'auth_failed' })
  const late = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
  await expect(transaction(pool, (c) => finishAuthentication(c, lib(), admin, 'login', late.challengeId, { id: 'cred-1' }, new Date(now.getTime() + 5 * 60_000 + 1)))).rejects.toMatchObject({ code: 'auth_failed' })
  const step = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'step_up', otherAccountId, now))
  await expect(transaction(pool, (c) => finishAuthentication(c, lib(), admin, 'step_up', step.challengeId, { id: 'cred-1' }, now))).rejects.toMatchObject({ code: 'auth_failed' })
})
it('rejects a disabled account at sign-in', async () => {
  await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [accountId])
  const auth = await transaction(pool, (c) => authenticationOptions(c, lib(), admin, 'login', null, now))
  await expect(transaction(pool, (c) => finishAuthentication(c, lib(), admin, 'login', auth.challengeId, { id: 'cred-1' }, now))).rejects.toMatchObject({ code: 'auth_failed' })
})
```

Setup: two `active` accounts (`accountId`, `otherAccountId`); the first test registers `cred-1` for `accountId`; later tests insert `cred-1` directly when run alone.

- [ ] **Step 3: Run to verify failure**

Run: `npm -w apps/control-plane test -- webauthn`
Expected: FAIL.

- [ ] **Step 4: Implement `webauthn.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import * as simple from '@simplewebauthn/server'
import type { AdminConfig } from '../config.js'
import { AdminAuthError } from './accounts.js'

export type WebAuthnLib = Pick<typeof simple, 'generateRegistrationOptions' | 'verifyRegistrationResponse' | 'generateAuthenticationOptions' | 'verifyAuthenticationResponse'>
export const defaultWebAuthn: WebAuthnLib = simple
const CHALLENGE_MS = 5 * 60_000
const fail = (): never => { throw new AdminAuthError(401, 'auth_failed') }

async function saveChallenge(client: PoolClient, kind: 'register' | 'login' | 'step_up', accountId: number | null, challenge: string, now: Date) {
  const id = randomUUID()
  await client.query('INSERT INTO vendor_auth_challenges(id,account_id,kind,challenge,expires_at) VALUES($1,$2,$3,$4,$5)', [id, accountId, kind, challenge, new Date(now.getTime() + CHALLENGE_MS)])
  return id
}
async function takeChallenge(client: PoolClient, id: string, kind: string, now: Date) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail()
  const row = await client.query('DELETE FROM vendor_auth_challenges WHERE id=$1 AND kind=$2 RETURNING account_id, challenge, expires_at', [id, kind])
  const c = row.rows[0]
  if (!c || new Date(c.expires_at) <= now) fail()
  return { accountId: c.account_id === null ? null : Number(c.account_id), challenge: c.challenge as string }
}
export async function registrationOptions(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, account: { id: number; email: string; displayName: string }, now: Date) {
  const existing = await client.query('SELECT credential_id, transports FROM vendor_passkeys WHERE account_id=$1', [account.id])
  const options = await lib.generateRegistrationOptions({
    rpName: admin.rpName, rpID: admin.rpId, userName: account.email, userDisplayName: account.displayName,
    userID: new TextEncoder().encode(String(account.id)), attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.rows.map((r) => ({ id: r.credential_id, transports: r.transports })),
  })
  return { challengeId: await saveChallenge(client, 'register', account.id, options.challenge, now), options }
}
export async function finishRegistration(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, accountId: number, challengeId: string, response: unknown, label: string, now: Date) {
  const c = await takeChallenge(client, challengeId, 'register', now)
  if (c.accountId !== accountId) fail()
  let result
  try { result = await lib.verifyRegistrationResponse({ response: response as never, expectedChallenge: c.challenge, expectedOrigin: admin.origin, expectedRPID: admin.rpId, requireUserVerification: true }) } catch { fail() }
  if (!result?.verified || !result.registrationInfo) fail()
  const cred = result!.registrationInfo!.credential
  await client.query('INSERT INTO vendor_passkeys(credential_id,account_id,public_key,counter,transports,label,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [cred.id, accountId, Buffer.from(cred.publicKey), cred.counter, cred.transports ?? [], String(label ?? '').slice(0, 60), now])
}
export async function authenticationOptions(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, kind: 'login' | 'step_up', accountId: number | null, now: Date) {
  const allow = kind === 'step_up' ? (await client.query('SELECT credential_id, transports FROM vendor_passkeys WHERE account_id=$1', [accountId])).rows.map((r) => ({ id: r.credential_id, transports: r.transports })) : undefined
  const options = await lib.generateAuthenticationOptions({ rpID: admin.rpId, userVerification: 'required', ...(allow ? { allowCredentials: allow } : {}) })
  return { challengeId: await saveChallenge(client, kind, kind === 'step_up' ? accountId : null, options.challenge, now), options }
}
export async function finishAuthentication(client: PoolClient, lib: WebAuthnLib, admin: AdminConfig, kind: 'login' | 'step_up', challengeId: string, response: unknown, now: Date) {
  const c = await takeChallenge(client, challengeId, kind, now)
  const id = (response as { id?: unknown })?.id
  if (typeof id !== 'string' || id.length > 1024) fail()
  const row = await client.query("SELECT p.credential_id, p.account_id, p.public_key, p.counter, p.transports FROM vendor_passkeys p JOIN vendor_accounts a ON a.id=p.account_id WHERE p.credential_id=$1 AND a.status='active' FOR UPDATE OF p", [id])
  const key = row.rows[0]
  if (!key || (kind === 'step_up' && Number(key.account_id) !== c.accountId)) fail()
  let result
  try { result = await lib.verifyAuthenticationResponse({ response: response as never, expectedChallenge: c.challenge, expectedOrigin: admin.origin, expectedRPID: admin.rpId, requireUserVerification: true, credential: { id: key.credential_id, publicKey: new Uint8Array(key.public_key), counter: Number(key.counter), transports: key.transports } }) } catch { fail() }
  if (!result?.verified) fail()
  await client.query('UPDATE vendor_passkeys SET counter=$2, last_used_at=$3 WHERE credential_id=$1', [id, result!.authenticationInfo.newCounter, now])
  return { accountId: Number(key.account_id) }
}
```

Adjust option and field names to the v14 types recorded in Step 1; the tests' stub shapes must match.

- [ ] **Step 5: Run tests**

Run: `npm -w apps/control-plane test -- webauthn && npm -w apps/control-plane run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane/package.json package-lock.json apps/control-plane/src/admin-auth
git commit -m "feat(cp): verify vendor passkeys"
```

---

### Task 10: Public authentication routes

**Files:**
- Create: `apps/control-plane/src/admin-auth/routes.ts`
- Modify: `apps/control-plane/src/http.ts` (dispatch `/v1/admin/auth/*` before `customerHttp`, see Step 3)
- Test: `apps/control-plane/src/admin-auth/__tests__/routes.live.test.ts` (DB-gated, real HTTP via `createApp`)

**Interfaces:**
- Consumes: Tasks 4-9.
- Produces HTTP (all `POST`, JSON body, anonymous-signed per Task 1; `remote` = value of header `x-nasq-client-ip`, forwarded by the BFF, used only for attempt scopes):

| Path | Body | Success |
|---|---|---|
| `/v1/admin/auth/invitation` | `{ token }` | `200 { email, purpose }` |
| `/v1/admin/auth/enroll/passkey/options` | `{ token }` | `200 { challenge_id, options }` |
| `/v1/admin/auth/enroll/passkey/verify` | `{ token, challenge_id, response, label }` | `204` |
| `/v1/admin/auth/enroll/totp` | `{ token }` | `200 { totp_uri, totp_box }` (box = base64 sealed secret, returned to the BFF only) |
| `/v1/admin/auth/enroll/complete` | `{ token, password, totp_code, totp_box }` | `200 { recovery_codes, session, expires_at, idle_expires_at }` |
| `/v1/admin/auth/passkey/options` | `{}` | `200 { challenge_id, options }` |
| `/v1/admin/auth/passkey/verify` | `{ challenge_id, response }` | `200 { session, expires_at, idle_expires_at }` (step-up fresh) |
| `/v1/admin/auth/fallback` | `{ email, password, totp_code }` | same as above (step-up not fresh) |
| `/v1/admin/auth/recovery` | `{ email, password, recovery_code }` | same as above (step-up not fresh); code marked used |
| `/v1/admin/auth/step-up/options` | `{}` + header `x-nasq-session` | `200 { challenge_id, options }` |
| `/v1/admin/auth/step-up/verify` | `{ challenge_id, response }` + header `x-nasq-session` | `204` |
| `/v1/admin/auth/logout` | `{}` + header `x-nasq-session` | `204` |

Every failure in these routes maps to `401 { code: 'auth_failed' }`, `429 { code: 'rate_limited' }`, `422 { code: 'invalid' }` or `503 { code: 'admin_unavailable' }` (when `config.admin` is undefined). No other codes or messages leave this module.

- [ ] **Step 1: Write the failing tests** (representative; one `it` per row above in the final file)

```ts
// routes.live.test.ts: createApp(pool, { ...config, admin }) on an ephemeral port; helper `post(path, body, session?)`
// signs with signServiceRequest({ method:'POST', path, body, actor:'anonymous', anonymous:true, issuer: config.installationId, key: config.key }).

it('signs in with a password and TOTP, and refuses the same TOTP code twice', async () => {
  const code = totpAt(secret, totpStep(Date.now()))
  const first = await post('/v1/admin/auth/fallback', { email: 'Owner@Nasq.sa', password, totp_code: code })
  expect(first.status).toBe(200)
  expect(first.body.session).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/)
  const replay = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password, totp_code: code })
  expect(replay.status).toBe(401)
  expect(replay.body).toEqual({ code: 'auth_failed' })
})
it('answers identically for unknown email and wrong password', async () => {
  const unknown = await post('/v1/admin/auth/fallback', { email: 'nobody@nasq.sa', password, totp_code: '123456' })
  const wrong = await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: 'not the password', totp_code: '123456' })
  expect([unknown.status, unknown.body]).toEqual([wrong.status, wrong.body])
})
it('locks after five failures', async () => {
  for (let i = 0; i < 5; i++) await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password: 'wrong wrong wrong', totp_code: '000000' })
  expect((await post('/v1/admin/auth/fallback', { email: 'owner@nasq.sa', password, totp_code: totpAt(secret, totpStep(Date.now())) })).status).toBe(429)
})
it('uses a recovery code once', async () => {
  expect((await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password, recovery_code: recoveryCodes[0] })).status).toBe(200)
  expect((await post('/v1/admin/auth/recovery', { email: 'owner@nasq.sa', password, recovery_code: recoveryCodes[0] })).status).toBe(401)
})
it('rejects unsigned and numeric-actor requests to auth routes', async () => {
  expect((await rawPost('/v1/admin/auth/passkey/options', {}, {})).status).toBe(401)
})
it('reports admin_unavailable when admin settings are absent', async () => {
  // second app instance with config.admin undefined
  expect((await postTo(noAdminOrigin, '/v1/admin/auth/passkey/options', {})).body).toEqual({ code: 'admin_unavailable' })
})
```

The fixture enrolls the owner through the real routes with the stubbed WebAuthn library from Task 9 injected via `createApp(pool, config, { webauthn: stubLib })` (add this optional third parameter, defaulting to `defaultWebAuthn`).

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- routes`
Expected: FAIL.

- [ ] **Step 3: Implement**

`routes.ts` exports

```ts
export async function adminAuthHttp(pool: Pool, config: Config, deps: { webauthn: WebAuthnLib; now?: () => Date }, req: { method: string; pathname: string; path: string; raw: Buffer; headers: IncomingHttpHeaders }): Promise<{ status: number; data?: unknown } | null>
```

It returns `null` unless `pathname.startsWith('/v1/admin/auth/')`. Otherwise:
1. `config.admin` undefined → `503 admin_unavailable`.
2. Method must be `POST`, else `404 not_found`.
3. `verifyServiceRequest({ method, path, body: raw, key: config.key, headers, anonymous: true })` must return a result with `issuer === config.installationId`; insert the nonce into `service_nonces` exactly like `authorize()` (`http.ts:182-193`); failure → `401 auth_failed`.
4. Parse the body with a zod schema per path (strict objects, string length limits: token 43, email 254, password 256, codes 6 / 14, label 60, response object ≤ 16 KB); failure → `422 invalid`.
5. Run the handler inside `transaction(pool, ...)`; `AdminAuthError` maps to its status and `{ code }` with `last_owner`, `conflict` and `forbidden` mapped to `401 auth_failed` on these public routes; any other error → `401 auth_failed` after `console.error('admin auth failure', error.name)` (never the message).

Handlers:
- `fallback`: scopes `[account:<normalized email>, ip:<remote>]` → `checkAllowed`; load account by email (`active` only), `verifyPassword`, then `checkTotp` against `open(config.admin.secretKey, secret_box)` with `last_step`; on success update `last_step`, `recordSuccess`, `createSession(..., false)`, audit `auth.signed_in` with reason `fallback`; on any failure `recordFailure` (in a separate committed transaction so the rollback of the main one does not undo the count) and `401`.
- `recovery`: same scopes; password then `UPDATE vendor_recovery_codes SET used_at=now() WHERE account_id=$1 AND code_hash=$2 AND used_at IS NULL RETURNING 1`; audit reason `recovery`.
- `passkey/verify`: `finishAuthentication(..., 'login', ...)` → `createSession(..., true)`; audit reason `passkey`. Failures recorded against `ip:<remote>` only.
- `step-up/*`: `resolveSession` from header `x-nasq-session`, then `authenticationOptions('step_up', accountId)` / `finishAuthentication('step_up')` + `markStepUp`; audit `auth.step_up`.
- `logout`: `resolveSession` then `revokeSession`; audit `auth.signed_out`.
- `invitation`, `enroll/*`: `openInvitation` on each call. `enroll/passkey/verify` for a `reset` invitation first deletes the account's passkeys, TOTP, recovery codes and revokes sessions. `enroll/totp` returns `totp_box` = `seal(secretKey, newTotpSecret()).toString('base64')`. `enroll/complete` passes `passkeyRegistered` = existence of a passkey for the account created at or after the invitation's `created_at`, then `createSession(..., true)`.

In `http.ts` `createApp`, add the optional `deps` parameter and, right after `const raw = await bodyBytes(req)`, insert:

```ts
      const adminResponse = await adminAuthHttp(pool, config, { webauthn: deps?.webauthn ?? defaultWebAuthn }, { method, pathname, path, raw, headers: req.headers })
      if (adminResponse) return adminResponse.data === undefined ? (res.writeHead(adminResponse.status), res.end()) : respond(res, adminResponse.status, adminResponse.data)
```

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- routes`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src
git commit -m "feat(cp): add vendor sign-in, enrollment and step-up routes"
```

---

### Task 11: Session-based `authorize()` and step-up enforcement

**Files:**
- Modify: `apps/control-plane/src/http.ts:182-197` (`authorize`, `requireCapability`)
- Create: `apps/control-plane/src/__tests__/helpers/vendor-session.ts`
- Modify: every control-plane test that signs vendor requests (find with `rg -l "signServiceRequest|vendor_memberships" apps/control-plane/src`)
- Test: `apps/control-plane/src/__tests__/authorize-session.live.test.ts`

**Interfaces:**
- Consumes: `resolveSession` (Task 7), `STEP_UP_CAPABILITIES` (Task 5).
- Produces:
  - `authorize()` returns `{ actor: number; capabilities: VendorCapability[]; stepUpFresh: boolean }`; `actor` is the account id
  - `requireCapability(auth, capability)` throws `403 { code: 'step_up_required' }` when `capability` is in `STEP_UP_CAPABILITIES`, the request method is not `GET`, and `!auth.stepUpFresh` (reading lists never needs step-up); catalog publication routes call `requireStepUp(auth)` explicitly. `authorize()` therefore also returns `method`.
  - Test helper `vendorSession(pool, issuer, capabilitiesOrRoles, { stepUp = true } = {}): Promise<{ accountId: number; headers(method, path, body?): Record<string,string> }>` — creates an `active` account (roles mapped from capabilities by choosing `owner` when all are present, else inserting the membership row directly), a session, and returns signed headers including `x-nasq-session`

- [ ] **Step 1: Write the failing tests**

```ts
it('rejects requests without a session, with a forged actor, or for a disabled account', async () => {
  const s = await vendorSession(pool, issuer, ['vendor.read'])
  const noSession = s.headers('GET', '/v1/context'); delete noSession['x-nasq-session']
  expect((await get('/v1/context', noSession)).status).toBe(401)
  const forged = signServiceRequest({ method: 'GET', path: '/v1/context', actor: s.accountId + 1, issuer, key })
  expect((await get('/v1/context', { ...forged, 'x-nasq-session': s.headers('GET', '/v1/context')['x-nasq-session'] })).status).toBe(401)
  expect((await get('/v1/context', { ...s.headers('GET', '/v1/context'), 'x-nasq-session': 'garbage' })).status).toBe(401)
  await pool.query("UPDATE vendor_accounts SET status='disabled' WHERE id=$1", [s.accountId])
  expect((await get('/v1/context', s.headers('GET', '/v1/context'))).status).toBe(401)
})
it('asks for step-up before operations', async () => {
  const s = await vendorSession(pool, issuer, ['vendor.read', 'vendor.tenants.manage', 'vendor.operations.run'], { stepUp: false })
  const r = await post(`/v1/tenants/${tenantId}/operations`, { request_id: randomUUID(), type: 'health' }, s)
  expect(r.status).toBe(403); expect(r.body.code).toBe('step_up_required')
})
it('applies a role revocation on the next request', async () => {
  const s = await vendorSession(pool, issuer, ['vendor.read', 'vendor.audit.read'])
  expect((await get('/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(200)
  await pool.query("UPDATE vendor_memberships SET capabilities=ARRAY['vendor.read'] WHERE actor_uid=$1", [s.accountId])
  expect((await get('/v1/audit', s.headers('GET', '/v1/audit'))).status).toBe(403)
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- authorize-session`
Expected: FAIL.

- [ ] **Step 3: Implement**

Replace `authorize` with:

```ts
async function authorize(pool: Pool, req: IncomingMessage, raw: string, config: Config): Promise<{ actor: number; capabilities: VendorCapability[]; stepUpFresh: boolean }> {
  const signed = verifyServiceRequest({ method: req.method ?? '', path: req.url ?? '', body: raw, key: config.key, headers: req.headers })
  if (!signed || signed.issuer !== config.installationId || typeof signed.actor !== 'number') throw new ApiError(401, 'unauthorized', 'Invalid service assertion')
  return transaction(pool, async (client) => {
    await client.query('DELETE FROM service_nonces WHERE expires_at < now()')
    const nonce = await client.query('INSERT INTO service_nonces(issuer,nonce,expires_at) VALUES($1,$2,now()+interval \'60 seconds\') ON CONFLICT DO NOTHING RETURNING nonce', [signed.issuer, signed.nonce])
    if (!nonce.rowCount) throw new ApiError(401, 'unauthorized', 'Replayed service assertion')
    let session
    try { session = await resolveSession(client, req.headers['x-nasq-session'], new Date()) } catch { throw new ApiError(401, 'unauthorized', 'Session is not valid') }
    if (session.accountId !== signed.actor) throw new ApiError(401, 'unauthorized', 'Session is not valid')
    const membership = await client.query('SELECT capabilities FROM vendor_memberships WHERE issuer=$1 AND actor_uid=$2 AND revoked_at IS NULL', [signed.issuer, signed.actor])
    if (!membership.rowCount) throw new ApiError(403, 'forbidden', 'Vendor membership is not active')
    return { actor: signed.actor, capabilities: membership.rows[0].capabilities as VendorCapability[], stepUpFresh: session.stepUpFresh, method: (req.method ?? '').toUpperCase() }
  })
}

function requireCapability(auth: { capabilities: VendorCapability[]; stepUpFresh?: boolean; method?: string }, capability: VendorCapability): void {
  if (!auth.capabilities.includes(capability)) throw new ApiError(403, 'forbidden', 'Vendor capability is required')
  if (auth.method !== 'GET' && STEP_UP_CAPABILITIES.includes(capability) && !auth.stepUpFresh) throw new ApiError(403, 'step_up_required', 'Confirm with your passkey')
}
export function requireStepUp(auth: { stepUpFresh?: boolean }): void {
  if (!auth.stepUpFresh) throw new ApiError(403, 'step_up_required', 'Confirm with your passkey')
}
```

Capability checks inside `packageHttp`, `commercialHttp`, `routesB` and `invitationVendorHttp` receive `capabilities` but not `stepUpFresh`: pass `stepUpFresh` in `commercialInput` and in the `packageHttp` input, and in each of those modules route their capability checks through one local `need(input, capability)` that applies the same step-up rule (read each module's existing `need`/capability check first; `routes-b.ts:39` already has `need(input, ...)`). Call `requireStepUp(auth)` in the catalog publication handlers (find with `rg -n "publish" apps/control-plane/src/http.ts apps/control-plane/src/package-http.ts apps/control-plane/src/commercial`).

Create the helper and replace every direct `INSERT INTO vendor_memberships` + `signServiceRequest` pair in tests with `vendorSession(...)`. Mock-pool tests (`registry-http.test.ts`, `managed-registration.test.ts`) add a branch that answers the `vendor_sessions` select with one active row whose `account_id` equals the signed actor.

- [ ] **Step 4: Run the whole control-plane suite**

Run: `CONTROL_TEST_DATABASE_URL=postgres://127.0.0.1/nasq_control_scratch_p2 npm -w apps/control-plane test`
Expected: PASS, same skipped-test count as before this task (record both counts in the commit body).

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src
git commit -m "feat(cp): authorize vendor requests from sessions with step-up"
```

---

### Task 12: Account management routes

**Files:**
- Create: `apps/control-plane/src/admin-auth/accounts-http.ts`
- Modify: `apps/control-plane/src/http.ts` (dispatch after `authorize`, before `packageHttp`)
- Test: `apps/control-plane/src/admin-auth/__tests__/accounts-http.live.test.ts`

**Interfaces:**
- Consumes: `authorize()` result (Task 11), `inviteAccount`, `issueReset`, `setRoles`, `disableAccount`.
- Produces HTTP (all need `vendor.accounts.manage`, therefore step-up, except `GET /v1/admin/me`):

| Route | Body | Success |
|---|---|---|
| `GET /v1/admin/me` | — | `200 { id, email, display_name, roles, capabilities }` (any session) |
| `GET /v1/admin/accounts` | — | `200 { items: [{ id, email, display_name, status, roles, passkeys, last_seen_at }], total }` |
| `POST /v1/admin/accounts` | `{ email, display_name, roles, reason }` | `201 { id, invitation_token, expires_at }` |
| `POST /v1/admin/accounts/:id/roles` | `{ roles, reason }` | `204` |
| `POST /v1/admin/accounts/:id/disable` | `{ reason }` | `204` |
| `POST /v1/admin/accounts/:id/reset` | `{ reason }` | `200 { invitation_token, expires_at }` |

Errors: `403 forbidden`, `403 step_up_required`, `409 { code: 'last_owner' }`, `409 { code: 'conflict' }`, `422 invalid`.

- [ ] **Step 1: Write the failing tests**

```ts
it('lets only owners manage accounts, with step-up', async () => {
  const finance = await vendorSession(pool, issuer, ['vendor.read', 'vendor.billing.manage'])
  expect((await post('/v1/admin/accounts', { email: 'n@nasq.sa', display_name: 'N', roles: ['support'], reason: 'new hire' }, finance)).status).toBe(403)
  const owner = await ownerSession({ stepUp: false })
  expect((await post('/v1/admin/accounts', { email: 'n@nasq.sa', display_name: 'N', roles: ['support'], reason: 'new hire' }, owner)).body.code).toBe('step_up_required')
  const fresh = await ownerSession({ stepUp: true })
  const created = await post('/v1/admin/accounts', { email: 'N@Nasq.sa', display_name: 'N', roles: ['support'], reason: 'new hire' }, fresh)
  expect(created.status).toBe(201); expect(created.body.invitation_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect((await post('/v1/admin/accounts', { email: 'n@nasq.sa', display_name: 'N', roles: ['support'], reason: 'again' }, fresh)).body.code).toBe('conflict')
})
it('returns last_owner when the only owner removes their role', async () => {
  const owner = await ownerSession({ stepUp: true })
  const r = await post(`/v1/admin/accounts/${owner.accountId}/roles`, { roles: ['finance'], reason: 'oops' }, owner)
  expect(r.status).toBe(409); expect(r.body.code).toBe('last_owner')
})
it('disabling revokes the target sessions immediately', async () => {
  const owner = await ownerSession({ stepUp: true })
  const target = await vendorSession(pool, issuer, ['vendor.read'])
  expect((await post(`/v1/admin/accounts/${target.accountId}/disable`, { reason: 'left' }, owner)).status).toBe(204)
  expect((await get('/v1/context', target.headers('GET', '/v1/context'))).status).toBe(401)
})
```

`ownerSession` creates an owner through `inviteAccount` + direct activation, so roles and membership come from Task 5 code.

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- accounts-http`
Expected: FAIL.

- [ ] **Step 3: Implement** `accountsHttp(pool, config, input: { method; pathname; raw; auth })` returning `null` for other paths; strict zod bodies; ids matched with `/^\/v1\/admin\/accounts\/([1-9][0-9]{0,15})\/(roles|disable|reset)$/`; each mutation in `transaction(pool, ...)` calling Task 5/6 functions with actor `{ id: auth.actor }`; map `AdminAuthError` to its status and `{ code }`. Dispatch it in `http.ts` immediately after `const auth = await authorize(...)`.

- [ ] **Step 4: Run tests**

Run: `npm -w apps/control-plane test -- accounts-http`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src
git commit -m "feat(cp): add vendor account management routes"
```

---

### Task 13: Operator CLI and runbook

**Files:**
- Modify: `apps/control-plane/src/admin.ts:27-48` (remove `grant` and `revoke`; add `bootstrap-owner` and `reset-account`)
- Modify: `docs/operations/saas-commercial-runbook.md` (new section «حسابات لوحة تحكم نسق»)
- Test: `apps/control-plane/src/__tests__/admin-cli.live.test.ts`

**Interfaces:**
- Produces:
  - `npm -w apps/control-plane run admin -- bootstrap-owner <email> <display name> <reason>` → prints `<ADMIN_ORIGIN>/enroll#<token>`; exits 1 with `owner already exists` if any active or enrolling account holds `owner`
  - `npm -w apps/control-plane run admin -- reset-account <email> <reason>` → prints a reset link; works for any non-disabled account (the break-glass path for the last owner)
  - Both audit with actor `operator`.

- [ ] **Step 1: Write the failing test** (spawn the CLI with `tsx` and a scratch DB env)

```ts
it('bootstraps the first owner once', async () => {
  const first = await runCli(['bootstrap-owner', 'owner@nasq.sa', 'Owner', 'first owner'])
  expect(first.code).toBe(0); expect(first.stdout).toMatch(/^http:\/\/localhost:3100\/enroll#[A-Za-z0-9_-]{43}\n$/)
  const second = await runCli(['bootstrap-owner', 'other@nasq.sa', 'Other', 'second'])
  expect(second.code).toBe(1); expect(second.stderr).toMatch(/owner already exists/)
})
it('no longer accepts grant', async () => {
  expect((await runCli(['grant', '7', 'vendor.read', 'x'])).code).not.toBe(0)
})
```

`runCli` sets `CONTROL_DATABASE_URL` to the scratch URL, `ADMIN_SECRET_KEY`, `ADMIN_RP_ID=localhost`, `ADMIN_ORIGIN=http://localhost:3100`, and the other variables `getConfig()` requires (copy their names from `config.ts`).

- [ ] **Step 2: Run to verify failure**

Run: `npm -w apps/control-plane test -- admin-cli`
Expected: FAIL.

- [ ] **Step 3: Implement** the two commands with `transaction(pool, ...)`; `bootstrap-owner` takes `pg_advisory_xact_lock(hashtext('vendor-bootstrap'))`, checks `SELECT 1 FROM vendor_account_roles r JOIN vendor_accounts a ON a.id=r.account_id WHERE r.role='owner' AND a.status<>'disabled'`, then calls `inviteAccount(client, config.installationId, 'operator', { email, displayName, roles: ['owner'], reason }, new Date())`. Refuse to run when `config.admin` is undefined. Remove `positiveUid` if nothing else uses it.

Runbook section (Arabic, matching the file's style): first owner bootstrap, reset of a locked-out owner, and the rule that the link is sent by hand and expires in 24 hours.

- [ ] **Step 4: Run tests and all checks**

Run: `CONTROL_TEST_DATABASE_URL=postgres://127.0.0.1/nasq_control_scratch_p2 npm -w apps/control-plane test && npm -w apps/control-plane run build && npm test && python3 -B tools/git_policy.py --base main && python3 -B tools/arch_policy.py --base main`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/admin.ts apps/control-plane/src/__tests__/admin-cli.live.test.ts docs/operations/saas-commercial-runbook.md
git commit -m "feat(cp): bootstrap and reset vendor accounts from the CLI"
```

---

## After the last task

- Request the `odoo-reviewer` agent on the branch diff (contracts and control plane changed).
- Report fresh evidence: test counts (passed/skipped) before and after, the scratch database name, and that no `/v1/admin/*` route returns anything outside the documented codes.
- Do not merge; the merge needs the owner's authorization.
