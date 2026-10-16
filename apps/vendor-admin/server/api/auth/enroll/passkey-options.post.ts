import { authRoute, authFields, strict } from '../../../utils/auth-route'

export default authRoute('enroll-passkey-options', {
  path: '/v1/admin/auth/enroll/passkey/options',
  schema: strict({ token: authFields.token }),
  session: 'none',
})
