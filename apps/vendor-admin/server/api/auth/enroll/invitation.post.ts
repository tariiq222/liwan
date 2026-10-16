import { authRoute, authFields, strict } from '../../../utils/auth-route'

export default authRoute('enroll-invitation', {
  path: '/v1/admin/auth/invitation',
  schema: strict({ token: authFields.token }),
  session: 'none',
})
