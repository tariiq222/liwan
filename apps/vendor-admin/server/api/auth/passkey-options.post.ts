import { authRoute, strict } from '../../utils/auth-route'

export default authRoute('passkey-options', {
  path: '/v1/admin/auth/passkey/options',
  schema: strict({}),
  session: 'none',
})
