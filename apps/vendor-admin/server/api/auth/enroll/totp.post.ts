import { authRoute, authFields, strict } from '../../../utils/auth-route'

export default authRoute('enroll-totp', {
  path: '/v1/admin/auth/enroll/totp',
  schema: strict({ token: authFields.token }),
  session: 'none',
})
