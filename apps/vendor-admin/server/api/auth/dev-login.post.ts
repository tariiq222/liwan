import { authRoute, strict, completeSignIn } from '../../utils/auth-route'

export default authRoute('dev-login', {
  path: '/v1/admin/auth/dev-login',
  schema: strict({}),
  session: 'none',
  devOnly: true,
  onSuccess: completeSignIn,
})
