import { authRoute, authFields, strict, completeSignIn } from '../../utils/auth-route'

export default authRoute('fallback', {
  path: '/v1/admin/auth/fallback',
  schema: strict({ email: authFields.email, password: authFields.password, totp_code: authFields.totpCode }),
  session: 'none',
  onSuccess: completeSignIn,
})
