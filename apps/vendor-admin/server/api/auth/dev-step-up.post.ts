import { authRoute, strict } from '../../utils/auth-route'

export default authRoute('dev-step-up', {
  path: '/v1/admin/auth/dev-step-up',
  schema: strict({}),
  session: 'required',
  devOnly: true,
})
