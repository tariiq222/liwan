import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')
const locale = (lang: string, file: string) => JSON.parse(read(`i18n/locales/${lang}/${file}.json`))

const join = read('app/pages/join.vue')
const reset = read('app/pages/reset-password.vue')
const forgot = read('app/pages/forgot-password.vue')
const mobile = read('app/pages/account/mobile.vue')
const newUser = read('app/pages/settings/team/users/new.vue')
const security = read('app/components/access/users/UserSecurityForm.vue')
const securityPage = read('app/pages/settings/team/users/[userId]/security.vue')
const detail = read('app/pages/settings/team/users/[userId]/index.vue')
const login = read('app/pages/login.vue')
const settings = read('app/pages/account/settings.vue')
const useMe = read('app/composables/useMe.ts')
const middleware = read('app/middleware/mobile-required.global.ts')

describe('the emailed-link pages', () => {
  it.each([['join', join], ['reset-password', reset], ['forgot-password', forgot]])('%s is public, standalone and hydration-guarded', (_name, page) => {
    expect(page).toContain("layout: false, access: 'public'")
    expect(page).toContain('<SharedStandalonePage')
    expect(page).toContain('useHydrated')
    expect(page).not.toMatch(/console\./)
    expect(page).not.toMatch(/\b(ml|mr|pl|pr)-\d/)
  })

  it('join sends the token and the password only, and checks the link on mount', () => {
    expect(join).toContain('acceptInvitation({ token: token.value, password: password.value })')
    expect(join).not.toContain('mobileValue')
    expect(join).toContain("checkToken(token.value, 'invite')")
    expect(join).toContain('route.query.token')
    expect(join).toMatch(/catch \{\s*state\.value = 'form'/)
    expect(join).toContain('MIN_PASSWORD_LENGTH')
    expect(join.match(/<UFormField/g)?.length).toBe(2)
  })

  it('join explains an expired or used invitation in its own words, and reset keeps the generic link text', () => {
    expect(join).toContain("t('accountLink.join.invalidTitle')")
    expect(join).not.toContain("t('accountLink.invalidTitle')")
    expect(reset).toContain("t('accountLink.invalidTitle')")
    for (const lang of ['ar', 'en']) {
      const { accountLink } = locale(lang, 'invite')
      expect(accountLink.join.invalidTitle).toBeTruthy()
      expect(accountLink.join.invalidBody).toBeTruthy()
      expect(accountLink.join.invalidTitle).not.toBe(accountLink.invalidTitle)
      // The invitation link takes a password alone; the holder verifies a number later, from the account page.
      expect(accountLink.join.subtitle).not.toMatch(/mobile|جوال/i)
    }
  })

  it('the access error texts cover the refusals the account service answers, and nothing unused', () => {
    for (const lang of ['ar', 'en']) {
      const { errors } = locale(lang, 'access').access
      expect(errors.invitation_pending).toBeTruthy()
      expect(errors.user_inactive).toBeTruthy()
      expect(errors).not.toHaveProperty('work_email_required')
    }
  })

  it('join and reset show each password rule with an icon and a state text, not by colour alone', () => {
    for (const page of [join, reset]) {
      expect(page).toContain("rule.met ? 'i-lucide-check' : 'i-lucide-x'")
      expect(page).toContain("t('accountLink.ruleMet')")
      expect(page).toContain("t('accountLink.ruleUnmet')")
    }
    for (const lang of ['ar', 'en']) {
      expect(locale(lang, 'invite').accountLink.ruleMet).toBeTruthy()
      expect(locale(lang, 'invite').accountLink.ruleUnmet).toBeTruthy()
    }
  })

  it('reset sends only the token and the new password, for the reset purpose', () => {
    expect(reset).toContain("resetPassword({ token: token.value, password: password.value })")
    expect(reset).toContain("checkToken(token.value, 'reset')")
    expect(reset).not.toContain('mobile')
  })

  it('join and reset keep the typed values when the service is unavailable, and clear them otherwise', () => {
    for (const page of [join, reset]) {
      expect(page).toContain("formError.value = 'unavailable'")
      expect(page).toMatch(/if \(!keep(Password|Values)\) \{\s*password\.value = ''\s*confirm\.value = ''/)
      expect(page).toMatch(/<form v-else-if="state === 'form'"[\s\S]*v-if="formError"[\s\S]*<\/form>/)
    }
  })

  it('forgot-password answers the same way whatever the email, and never puts the email in a URL', () => {
    expect(forgot).toContain('requestPasswordReset({ email: email.value })')
    expect(forgot).toMatch(/if \(accountLinkFailure\(error\) === 'unavailable'\) unavailable\.value = true\s*else sent\.value = true/)
    expect(forgot).not.toContain('route.query')
    expect(forgot).toContain("to=\"/login\"")
  })

  it('the sign-in page links to forgot-password', () => {
    expect(login).toContain('to="/forgot-password"')
    expect(login).toContain("$t('auth.forgotPassword')")
  })
})

describe('the add-user form', () => {
  it('marks the name and email fields as required, on the field and on the input', () => {
    expect(newUser.match(/<UFormField[^>]*name="login"[^>]*\brequired>/g)?.length).toBe(2)
    expect(newUser).toMatch(/<UFormField[^>]*name="name" required>/)
    expect(newUser).toMatch(/<UInput id="name"[^>]* required /)
    expect(newUser.match(/<UInput id="login"[^>]* required /g)?.length).toBe(2)
  })
})

describe('the mobile step', () => {
  it('saves the normalized number and returns to where the user was going', () => {
    expect(mobile).toContain('requestCode(mobileValue.value)')
    expect(mobile).toContain("step.value = 'code'")
    expect(mobile).toContain('postLoginPath(me.value, route.query.next)')
    expect(mobile).toContain("'/account/settings'")
    expect(mobile).toContain('useSignOut()')
    expect(mobile).not.toContain('/api/auth/logout')
    expect(mobile).toContain("code === 'mobile_taken'")
  })

  it('reads the code through the shared normalizer, so Arabic-Indic digits are codes too', () => {
    expect(mobile).toContain("import { errorSeconds, normalizeCode } from '@/components/auth/loginFlow'")
    expect(mobile).toContain('normalizeCode(code.value)')
    expect(mobile).toContain('verifyCode(codeDigits.value)')
    expect(mobile).not.toContain('[0-9]{6}')
  })

  it('words each refused send itself, and counts the cooldown down from the server seconds', () => {
    expect(mobile).toMatch(/code === 'resend_cooldown'[\s\S]*countDown\(waitOf\(error\) \|\| RESEND_SECONDS\)/)
    for (const code of ['send_limit_reached', 'daily_send_cap', 'channel_unavailable']) expect(mobile).toContain(`code === '${code}'`)
    expect(mobile).toContain('error.details?.resend_after')
    expect(mobile).toContain('errorSeconds(error)')
  })

  it('answers a verify refusal with the one code the server sends', () => {
    expect(mobile).toContain("refusalOf(error) === 'invalid_code'")
    expect(mobile).not.toContain('code_expired')
    expect(mobile).not.toContain('too_many_attempts')
    for (const lang of ['ar', 'en']) {
      const step = locale(lang, 'invite').accountLink.mobileStep
      for (const gone of ['codeExpired', 'codeAttempts']) expect(step, `${lang}: ${gone}`).not.toHaveProperty(gone)
      for (const key of ['sendLimitReached', 'dailySendCap', 'channelUnavailable', 'invalidCode', 'resendIn']) expect(step, `${lang}: ${key}`).toHaveProperty(key)
      // An expired or burned code answers `invalid_code` on the server, so the sentence names both paths itself.
      expect(step.invalidCode).toMatch(/resend|new|جديد/)
    }
  })

  it('reads the identity again after the number is saved, because the save clears the verification stamp', () => {
    expect(useMe).toMatch(/const saved = await \$api\('\/api\/v1\/me\/mobile\/code'[\s\S]*await refreshNuxtData\('me'\)/)
  })

  it('signs out through the same composable as the account settings page', () => {
    expect(settings).toContain('useSignOut()')
    expect(settings).not.toContain('/api/auth/logout')
  })

  it('redirects through a global middleware that runs after the auth guard', () => {
    expect(middleware).toContain('mobileStepRedirect(useMe().me.value, to)')
    expect(middleware).toContain('navigateTo(redirect, { replace: true })')
    expect('mobile-required.global.ts' > 'auth.global.ts').toBe(true)
  })
})

describe('administrator screens never take or show a password', () => {
  it('the add-user form asks for no password and shows the seat line before sending', () => {
    expect(newUser).not.toMatch(/password/i)
    expect(newUser).toContain('useAdminUserSeats')
    expect(newUser).toContain("t('access.users.seatLine', { number: seatNumber, limit: seatLimit })")
    expect(newUser).toContain('data-testid="seat-line"')
    expect(newUser).toContain("t('access.users.sendInvitation')")
    expect(newUser).toContain("'access.users.invitationSentTitle'")
    // At the limit the request still goes out: an existing account takes no seat, a new one gets the server's refusal.
    expect(newUser).not.toMatch(/:disabled="[^"]*atSeatLimit"/)
    expect(newUser).toContain('if (identityMissing.value || selectedRoleIdsSnapshot.length === 0 || !companyId || !hydrated.value) return')
  })

  it('the employee path suggests the work email as the login and lets the administrator change it', () => {
    expect(newUser).toContain('candidate?.work_email')
    expect(newUser).toContain('grantFromEmployee.mutateAsync({ employee_id: selectedEmployeeId, login: login.value.trim(), assignments })')
  })

  it('the security screen sends a reset link and reactivates without a password, confirming inline', () => {
    expect(security).not.toMatch(/password|type="password"/i)
    expect(security).toContain("t('access.users.sendResetLink')")
    expect(security).toContain('<SharedInlineConfirm')
    expect(security).not.toContain('<UModal')
    expect(securityPage).not.toMatch(/password/i)
  })

  it('the user page shows the invitation actions, and its tab follows the new action name', () => {
    expect(detail).toContain('<SharedRecordSection v-if="invitation || invitationSuccess" id="invitation"')
    expect(detail).toContain("actions.includes('send_reset_link')")
    expect(detail).not.toContain('reset_password')
  })

  it('the invitation panel resends, corrects the email inline and cancels behind an inline confirmation', () => {
    for (const action of ['resend_invitation', 'edit_invitation', 'cancel_invitation']) expect(detail).toContain(`canInvite('${action}')`)
    expect(detail).toContain('<SharedInlineConfirm v-if="confirmingCancel"')
    expect(detail).toContain('useChangeAdminUserInvitationLogin')
    expect(detail).toContain('expected_version: user.version')
    expect(detail).not.toContain('<UModal')
    expect(detail).not.toMatch(/password/i)
  })
})

describe('locales', () => {
  const referenced = (source: string, namespace: string) => [...source.matchAll(new RegExp(`\\bt\\(['"]${namespace}\\.([A-Za-z.]+)['"]`, 'g'))].map(match => match[1]!)
  const has = (tree: Record<string, unknown>, path: string) => path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], tree) !== undefined

  it('every literal accountLink key the pages use exists in Arabic and English, and both trees match', () => {
    const keys = (tree: object, prefix = ''): string[] => Object.entries(tree).flatMap(([key, value]) => typeof value === 'object' ? keys(value, `${prefix}${key}.`) : [`${prefix}${key}`])
    for (const lang of ['ar', 'en']) {
      const tree = locale(lang, 'invite')
      for (const page of [join, reset, forgot, mobile]) for (const key of referenced(page, 'accountLink')) expect(has(tree.accountLink, key), `${lang}: accountLink.${key}`).toBe(true)
    }
    expect(keys(locale('ar', 'invite').accountLink).sort()).toEqual(keys(locale('en', 'invite').accountLink).sort())
  })

  it('the removed password keys are gone and the new access keys exist in both languages', () => {
    for (const lang of ['ar', 'en']) {
      const users = locale(lang, 'access').access.users
      for (const gone of ['password', 'passwordConfirmation', 'passwordMismatch', 'resetPassword', 'passwordReset', 'confirmResetPassword']) expect(users, `${lang}: ${gone}`).not.toHaveProperty(gone)
      for (const key of ['sendInvitation', 'seatLine', 'seatLimitReached', 'invitationSentTitle', 'sendResetLink', 'mobile', 'invitationState', 'resendInvitation', 'editInvitation', 'cancelInvitation']) expect(users, `${lang}: ${key}`).toHaveProperty(key)
      expect(Object.keys(users.invitationState).sort()).toEqual(['expired', 'failed', 'pending'])
      expect(Object.keys(users.invitationHint).sort()).toEqual(['expired', 'failed', 'pending'])
      expect(locale(lang, 'common').auth).toHaveProperty('forgotPassword')
    }
  })
})
