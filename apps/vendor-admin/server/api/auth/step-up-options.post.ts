import { authRoute, strict } from '../../utils/auth-route'

export default authRoute('step-up-options', {
  path: '/v1/admin/auth/step-up/options',
  schema: strict({}),
  session: 'required',
})
